(() => {
  const visual = document.querySelector('.brand-intro-visual');
  const logo = visual?.querySelector('.brand-intro-logo');
  const wordmark = visual?.querySelector('.brand-intro-wordmark');
  if (!visual || !logo || !wordmark) return;

  const text = 'VANTARMOR.COMMANDS';
  [...text].forEach((letter, index) => {
    const span = document.createElement('span');
    span.textContent = letter;
    if (letter === '.') span.className = 'brand-dot';
    wordmark.appendChild(span);
    window.setTimeout(() => span.classList.add('is-visible'), 1900 + index * 55);
  });

  window.setTimeout(() => visual.classList.add('is-active'), 650);
  window.setTimeout(() => logo.classList.add('is-spinning'), 850);
  window.setTimeout(() => {
    logo.hidden = true;
    wordmark.classList.add('is-active');
    window.setTimeout(() => wordmark.classList.add('is-turning'), 1900 + text.length * 55 + 250);
  }, 1850);
})();
