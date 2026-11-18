import "./style.css";

// The one interaction on the page: copy the install line.
const btn = document.querySelector("[data-copy]");
btn?.addEventListener("click", async () => {
  const text = btn.dataset.copy;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard is blocked on insecure origins and in some embeds — select it instead
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("install"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const label = btn.textContent;
  btn.textContent = "Copied";
  btn.dataset.copied = "true";
  setTimeout(() => {
    btn.textContent = label;
    delete btn.dataset.copied;
  }, 1400);
});
