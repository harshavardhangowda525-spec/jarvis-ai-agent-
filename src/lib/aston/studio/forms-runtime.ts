/**
 * The script every ASTON site loads as `_aston/forms.js` (client-safe string).
 * It makes `<form data-aston-form="id">` really work: validates in the browser,
 * sends to JARVIS's form handler, and shows the handler's REAL answer — never a
 * success it didn't get. The endpoint is filled in when the file is served
 * (preview) or written (deployment).
 */
export function formsRuntime(endpoint: string) {
  return `/* ASTON forms — sends to ${endpoint.replace(/\*\//g, "")} */
(function () {
  var ENDPOINT = ${JSON.stringify(endpoint)};
  function status(form, text, kind) {
    var el = form.querySelector("[data-form-status]");
    if (!el) { el = document.createElement("p"); el.setAttribute("data-form-status", ""); form.appendChild(el); }
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.setAttribute("data-state", kind);
    el.textContent = text;
  }
  function fieldError(input, text) {
    var id = input.name + "-error";
    var el = input.form.querySelector('[data-error-for="' + input.name + '"]') || document.getElementById(id);
    if (!el) { el = document.createElement("span"); el.id = id; el.setAttribute("data-error-for", input.name); el.className = "field-error"; input.insertAdjacentElement("afterend", el); }
    el.textContent = text || "";
    if (text) { input.setAttribute("aria-invalid", "true"); input.setAttribute("aria-describedby", id); } else input.removeAttribute("aria-invalid");
  }
  function message(input) {
    var v = input.validity;
    if (v.valueMissing) return "Please fill this in.";
    if (v.typeMismatch && input.type === "email") return "Please enter a valid email address.";
    if (v.patternMismatch || v.typeMismatch) return "Please check this.";
    if (v.tooShort) return "A little longer, please.";
    return input.validationMessage || "Please check this.";
  }
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || !form.matches || !form.matches("form[data-aston-form]")) return;
    e.preventDefault();
    var ok = true, first = null;
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "submit" || el.type === "button") return;
      if (el.checkValidity()) fieldError(el, "");
      else { ok = false; fieldError(el, message(el)); first = first || el; }
    });
    if (!ok) { status(form, "Please check the highlighted fields.", "error"); if (first) first.focus(); return; }
    var data = {};
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.type === "submit" || el.type === "button") return;
      if (el.type === "checkbox") data[el.name] = el.checked; else data[el.name] = el.value;
    });
    var btn = form.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    form.setAttribute("data-state", "sending");
    status(form, "Sending…", "loading");
    fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ form: form.getAttribute("data-aston-form"), data: data }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) { status(form, res.j.message || "Thank you — it's been received.", "success"); form.setAttribute("data-state", "success"); form.reset(); }
        else { status(form, (res.j && res.j.error) || "Sorry, it couldn't be sent. Please try again.", "error"); form.setAttribute("data-state", "error"); }
      })
      .catch(function () { status(form, "Couldn't reach the server — check your connection and try again.", "error"); form.setAttribute("data-state", "error"); })
      .then(function () { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } });
  });
  document.addEventListener("input", function (e) { var el = e.target; if (el && el.form && el.form.matches("form[data-aston-form]") && el.getAttribute("aria-invalid") && el.checkValidity()) fieldError(el, ""); });
})();
`;
}
