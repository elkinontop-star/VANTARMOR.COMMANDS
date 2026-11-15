"""Free, persistent Discord giveaways with toggle-to-join participation."""
import asyncio
import json
import os
import random
import re
import threading
import time
from pathlib import Path

import discord
from discord import app_commands

DATA_DIR = Path(os.getenv("VANTARMOR_DATA_DIR", "."))
STORE = DATA_DIR / "giveaways.json"
_STORE_LOCK = threading.RLock()
_END_LOCK = asyncio.Lock()
_TASKS = {}


def duration_seconds(value: str):
    match = re.fullmatch(r"\s*(\d+)\s*(m|min|minutes?|minutos?|h|hr|hrs|hours?|horas?|d|days?|dias?|w|weeks?|semanas?|mo|month|months|mes|meses|y|yr|year|years|ano|anos)\s*", value or "", re.IGNORECASE)
    if not match or int(match.group(1)) < 1:
        return None
    n, unit = int(match.group(1)), match.group(2).casefold()
    if unit in {"m", "min", "minute", "minutes", "minuto", "minutos"}: factor = 60
    elif unit in {"h", "hr", "hrs", "hour", "hours", "hora", "horas"}: factor = 3600
    elif unit in {"d", "day", "days", "dia", "dias"}: factor = 86400
    elif unit in {"w", "week", "weeks", "semana", "semanas"}: factor = 7 * 86400
    elif unit in {"mo", "month", "months", "mes", "meses"}: factor = 30 * 86400
    else: factor = 365 * 86400
    seconds = n * factor
    return seconds if 60 <= seconds <= 365 * 86400 else None


def _read():
    try:
        data = json.loads(STORE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _get(message_id):
    with _STORE_LOCK:
        return _read().get(str(message_id))


def _save(state):
    with _STORE_LOCK:
        data = _read()
        data[str(state["message_id"])] = state
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = STORE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(STORE)


def _embed(state, *, ended=None, winners=None):
    ended = state.get("ended", False) if ended is None else ended
    embed = discord.Embed(
        title="🎉 Sorteo terminado" if ended else "🎉 Sorteo",
        description=state["message"],
        color=discord.Color.blurple(),
        timestamp=discord.utils.utcnow(),
    )
    embed.add_field(name="Premio", value=state["prize"], inline=False)
    embed.add_field(name="Ganadores", value=str(state["winner_count"]), inline=True)
    embed.add_field(name="Participantes", value=str(len(state.get("entries", []))), inline=True)
    if ended:
        embed.add_field(name="Resultado", value=(", ".join(f"<@{uid}>" for uid in winners) if winners else "No hubo participantes."), inline=False)
    else:
        embed.add_field(name="Termina", value=f"<t:{int(state['ends_at'])}:R>", inline=True)
        embed.set_footer(text="Pulsa 🎉 Participar para entrar o volver a pulsar para salir.")
    return embed


class GiveawayEntryView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="🎉 Participar", style=discord.ButtonStyle.primary, custom_id="vantarmor:giveaway:join")
    async def join(self, interaction: discord.Interaction, button: discord.ui.Button):
        if interaction.user.bot:
            await interaction.response.send_message("Las cuentas bot no pueden participar.", ephemeral=True)
            return
        state = _get(interaction.message.id if interaction.message else 0)
        if not state or state.get("ended") or float(state.get("ends_at", 0)) <= time.time():
            await interaction.response.send_message("Este sorteo ya terminó o no está disponible.", ephemeral=True)
            return
        user_id = str(interaction.user.id)
        entries = set(state.get("entries", []))
        if user_id in entries:
            entries.remove(user_id)
            reply = "Saliste del sorteo. Puedes volver a entrar pulsando el botón."
        else:
            entries.add(user_id)
            reply = "¡Ya estás participando! Pulsa otra vez para salir."
        state["entries"] = sorted(entries)
        try:
            _save(state)
            await interaction.message.edit(embed=_embed(state), view=self)
        except (OSError, discord.Forbidden, discord.HTTPException):
            await interaction.response.send_message("No pude guardar tu participación. Inténtalo otra vez.", ephemeral=True)
            return
        await interaction.response.send_message(reply, ephemeral=True)


async def _finish_giveaway(bot, message_id):
    async with _END_LOCK:
        state = _get(message_id)
        if not state or state.get("ended"):
            return
        delay = float(state["ends_at"]) - time.time()
        if delay > 0:
            await asyncio.sleep(delay)
            state = _get(message_id)
            if not state or state.get("ended"):
                return
        entries = list(dict.fromkeys(state.get("entries", [])))
        winners = random.sample(entries, min(int(state["winner_count"]), len(entries))) if entries else []
        state["ended"] = True
        state["winners"] = winners
        try:
            _save(state)
        except OSError as error:
            print(f"No se pudo guardar el fin del sorteo {message_id}: {type(error).__name__}")
            return
        channel = bot.get_channel(int(state["channel_id"]))
        try:
            if channel is None:
                channel = await bot.fetch_channel(int(state["channel_id"]))
            message = await channel.fetch_message(int(message_id))
            view = GiveawayEntryView()
            for item in view.children:
                item.disabled = True
            await message.edit(embed=_embed(state, ended=True, winners=winners), view=view)
            if winners:
                await channel.send(
                    "🎊 Ganador(es) de **" + state["prize"] + "**: " + ", ".join(f"<@{uid}>" for uid in winners),
                    allowed_mentions=discord.AllowedMentions(users=True, roles=False, everyone=False),
                )
        except (discord.NotFound, discord.Forbidden, discord.HTTPException) as error:
            print(f"No se pudo publicar el resultado del sorteo {message_id}: {type(error).__name__}")


def _schedule(bot, message_id):
    task = _TASKS.get(str(message_id))
    if task is None or task.done():
        _TASKS[str(message_id)] = asyncio.create_task(_finish_giveaway(bot, int(message_id)))


async def resume_giveaways(bot):
    """Restore persistent buttons and end timers after a process restart."""
    bot.add_view(GiveawayEntryView())
    with _STORE_LOCK:
        states = list(_read().values())
    for state in states:
        if not state.get("ended"):
            _schedule(bot, int(state["message_id"]))


def _register_giveaway(tree, bot, command_name: str, command_description: str, *, advanced: bool = False):
    if not getattr(bot, "giveaway_view_registered", False):
        bot.add_view(GiveawayEntryView())
        bot.giveaway_view_registered = True

    @tree.command(name=command_name, description=command_description)
    @app_commands.describe(
        ganadores="Cantidad de ganadores (1 a 25)",
        duracion="Duración: 1m, 1h, 1d, 1w, 1mo o 1year (máximo 1 año)",
        mensaje="Mensaje que aparecerá en el embed",
        premio="Qué se sortea",
    )
    async def giveaway_command(interaction: discord.Interaction, ganadores: app_commands.Range[int, 1, 25], duracion: str, mensaje: str, premio: str):
        if interaction.guild is None or interaction.channel is None:
            await interaction.response.send_message("Este comando solo funciona dentro de un servidor.", ephemeral=True)
            return
        seconds = duration_seconds(duracion)
        if seconds is None:
            await interaction.response.send_message("Duración no válida. Usa 1m, 1h, 1d, 1w, 1mo o 1year; máximo 1 año.", ephemeral=True)
            return
        mensaje, premio = mensaje.strip(), premio.strip()
        if not mensaje or len(mensaje) > 1500 or not premio or len(premio) > 200:
            await interaction.response.send_message("El mensaje debe tener 1–1500 caracteres y el premio 1–200.", ephemeral=True)
            return
        now = time.time()
        state = {
            "guild_id": interaction.guild.id,
            "channel_id": interaction.channel.id,
            "message_id": 0,
            "created_by": interaction.user.id,
            "created_at": int(now),
            "ends_at": now + seconds,
            "winner_count": int(ganadores),
            "message": mensaje,
            "prize": premio,
            "entries": [],
            "ended": False,
            "winners": [],
        }
        await interaction.response.defer(ephemeral=True, thinking=True)
        try:
            giveaway_message = await interaction.channel.send(embed=_embed(state), view=GiveawayEntryView(), allowed_mentions=discord.AllowedMentions.none())
            state["message_id"] = giveaway_message.id
            _save(state)
        except (OSError, discord.Forbidden, discord.HTTPException):
            await interaction.followup.send("No se pudo crear/guardar el sorteo. Revisa permisos y el volumen VANTARMOR_DATA_DIR.", ephemeral=True)
            return
        _schedule(bot, giveaway_message.id)
        await interaction.followup.send(f"✅ Sorteo publicado en {interaction.channel.mention}.", ephemeral=True)

    return giveaway_command


def register_giveaway_commands(tree, bot):
    return _register_giveaway(tree, bot, "sorteo", "Crea un sorteo gratuito con botón para participar")


def register_advanced_giveaway_commands(tree, bot):
    return _register_giveaway(tree, bot, "sorteo-avanzado", "Crea un sorteo avanzado gratis con premio configurable")


__all__ = ["register_giveaway_commands", "register_advanced_giveaway_commands", "resume_giveaways", "duration_seconds"]
