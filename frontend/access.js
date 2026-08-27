const form = document.getElementById("access-form");
const input = document.getElementById("access-code");
const error = document.getElementById("access-error");

const status = await fetch("/api/auth/status").then((response) => response.json()).catch(() => null);
if (status?.authenticated || status?.required === false) window.location.replace("/");

form.addEventListener("submit", async (event) => {
  event.preventDefault(); error.textContent = "";
  const button = form.querySelector("button"); button.disabled = true;
  try {
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: input.value }) });
    const result = await response.json();
    input.value = "";
    if (!response.ok) throw new Error(result.summary || "Access was not accepted.");
    window.location.replace("/");
  } catch (failure) {
    error.textContent = failure.message; input.focus();
  } finally {
    button.disabled = false;
  }
});
