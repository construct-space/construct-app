package oauth

import (
	"embed"
	"strings"
)

// Styled OAuth callback pages — the success/error screens the browser
// lands on after a provider login bounces back to brain's temporary
// localhost listener. Ported from the standalone operator so Claude,
// OpenAI/Codex, and Gemini all render the same construct.space hero
// instead of a bare "<h1>connected</h1>".

//go:embed logos/*.svg
var logoFS embed.FS

// providerLogoSVG returns the inline SVG for a provider label (e.g.
// "Claude", "OpenAI"). Unknown providers return an empty string and the
// caller drops the logo slot from the header row.
func providerLogoSVG(providerName string) string {
	key := strings.ToLower(strings.TrimSpace(providerName))
	file := map[string]string{
		"claude":    "anthropic",
		"anthropic": "anthropic",
		"openai":    "openai",
		"chatgpt":   "openai",
		"codex":     "openai",
		"gemini":    "google",
		"google":    "google",
		"construct": "construct",
	}[key]
	if file == "" {
		return ""
	}
	data, err := logoFS.ReadFile("logos/" + file + ".svg")
	if err != nil {
		return ""
	}
	return string(data)
}

// providerSlotClass returns the CSS modifier that tints a provider's logo
// to its brand colour. Unknown providers fall back to the default slate.
func providerSlotClass(providerName string) string {
	switch strings.ToLower(strings.TrimSpace(providerName)) {
	case "claude", "anthropic":
		return "slot-claude"
	case "openai", "chatgpt", "codex":
		return "slot-openai"
	case "gemini", "google":
		return "slot-gemini"
	}
	return ""
}

// callbackBaseCSS — shared visual language for every callback page.
// Matches the construct.space hero: warm cream canvas, oversized headline
// ending in a red period, primary red CTA.
const callbackBaseCSS = `
:root{
  --bg:#FBF7F5;--border:#EDE6E1;
  --fg:#14110F;--muted:#6B6560;
  --accent:#FF2D55;--danger:#D7263D;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  font:15px/1.55 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;
  margin:0;background:var(--bg);color:var(--fg);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:48px 32px;
}
.hero{width:100%;max-width:640px;text-align:left}
.logos{display:flex;align-items:center;gap:22px;margin-bottom:48px}
.logos .slot{display:flex;align-items:center;justify-content:center;color:var(--fg)}
.logos .slot svg{height:44px;width:auto;display:block}
.logos .slot-brand{color:var(--accent)}
.logos .slot-brand svg{height:48px}
.logos .slot-claude{color:#D97757}
.logos .slot-openai{color:var(--fg)}
.logos .slot-gemini{color:#4285F4}
.logos .link{color:var(--accent);display:flex;align-items:center;opacity:.9}
.logos .link svg{width:20px;height:20px;display:block}
.logos .link.error{color:var(--danger)}
.eyebrow{
  display:inline-flex;align-items:center;gap:8px;margin-bottom:16px;
  font-size:12px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;
  color:var(--accent);
}
.eyebrow.error{color:var(--danger)}
h1{
  margin:0 0 24px;font-size:64px;font-weight:800;letter-spacing:-.02em;
  color:var(--fg);line-height:1;
}
h1 .dot{color:var(--accent)}
p{margin:0 0 16px;font-size:16px;color:var(--muted);line-height:1.6;max-width:560px}
p.lead{color:var(--fg);font-size:18px;margin-bottom:12px;font-weight:400}
p.mono{
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:var(--fg);
  background:rgba(255,45,85,.06);padding:12px 14px;border-radius:8px;
  border-left:3px solid var(--accent);white-space:pre-wrap;word-break:break-word;
  max-width:560px;
}
.actions{display:flex;gap:12px;margin-top:32px;align-items:center}
button.close{
  appearance:none;background:var(--accent);color:#fff;border:none;border-radius:8px;
  padding:14px 32px;font:600 14px/1 -apple-system,Inter,system-ui,sans-serif;
  cursor:pointer;
  transition:filter .15s ease,transform .05s ease;
}
button.close:hover{filter:brightness(1.06)}
button.close:active{transform:translateY(1px)}
.hint{font-size:13px;color:var(--muted)}
.hint kbd{background:#fff;border:1px solid var(--border);padding:2px 7px;border-radius:5px;font:12px ui-monospace,monospace;color:var(--fg)}
.footer{
  margin-top:64px;font-size:11px;color:var(--muted);letter-spacing:.22em;
  text-transform:uppercase;font-weight:700;
}
.footer .dot{color:var(--accent)}
`

// heartSVG is the small link glyph between the Construct mark and the
// provider logo — tints via currentColor for success/error states.
const heartSVG = `<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`

// closeScript tries window.close() (works when the OAuth flow popped a new
// tab), then falls back to a friendly "close this tab" nudge — browsers
// won't let scripts close tabs the user opened themselves.
const closeScript = `
function doClose(){
  try{window.close()}catch(e){}
  setTimeout(function(){
    if(!window.closed){
      document.body.innerHTML = '<div class="hero"><div class="eyebrow"><span>Almost there</span></div><h1>Close this tab<span class="dot">.</span></h1><p class="lead">Your browser wouldn&rsquo;t let us close it for you — press <kbd>&#8984;W</kbd> or click the tab&rsquo;s X.</p></div>';
    }
  },120);
}
`

// logoRow renders the "Construct ❤ Provider" hero row.
func logoRow(providerName, tone string) string {
	construct := providerLogoSVG("construct")
	provider := providerLogoSVG(providerName)
	linkClass := "link " + tone
	providerSlot := "slot " + providerSlotClass(providerName)
	var sb strings.Builder
	sb.WriteString(`<div class="logos">`)
	sb.WriteString(`<div class="slot slot-brand">` + construct + `</div>`)
	sb.WriteString(`<div class="` + linkClass + `">` + heartSVG + `</div>`)
	sb.WriteString(`<div class="` + providerSlot + `">` + provider + `</div>`)
	sb.WriteString(`</div>`)
	return sb.String()
}

// CallbackSuccessHTML returns the styled success page shown after an OAuth
// callback. providerName names the connected integration (e.g. "Claude").
func CallbackSuccessHTML(providerName string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Construct — Connected</title><style>` + callbackBaseCSS + `</style></head><body><div class="hero">` +
		logoRow(providerName, "success") +
		`<div class="eyebrow"><span>` + htmlEscape(providerName) + ` connected</span></div>
<h1>You're in<span class="dot">.</span></h1>
<p class="lead">Your ` + htmlEscape(providerName) + ` account is linked to Construct.</p>
<p>The app already picked up the session — you can close this tab and head back.</p>
<div class="actions">
  <button class="close" onclick="doClose()">Close tab</button>
  <span class="hint">or press <kbd>&#8984;W</kbd></span>
</div>
<div class="footer">Construct<span class="dot">.</span></div>
</div>
<script>` + closeScript + `</script>
</body></html>`
}

// CallbackErrorHTML returns the styled error page for OAuth callback
// failures. reason is the human-readable failure (e.g. "State mismatch").
func CallbackErrorHTML(providerName, reason string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Construct — Sign-in failed</title><style>` + callbackBaseCSS + `</style></head><body><div class="hero">` +
		logoRow(providerName, "error") +
		`<div class="eyebrow error"><span>Sign-in failed</span></div>
<h1>Sign-in failed<span class="dot">.</span></h1>
<p class="lead">Couldn&rsquo;t link ` + htmlEscape(providerName) + ` to Construct.</p>
<p>Usually a stale tab, a cancelled consent, or a clock-skew state mismatch. The reason below usually points at the fix.</p>
<p class="mono">` + htmlEscape(reason) + `</p>
<p>Close this tab and press <kbd>Sign in</kbd> again in the Construct app.</p>
<div class="actions">
  <button class="close" onclick="doClose()">Close tab</button>
  <span class="hint">or press <kbd>&#8984;W</kbd></span>
</div>
<div class="footer">Construct<span class="dot">.</span></div>
</div>
<script>` + closeScript + `</script>
</body></html>`
}
