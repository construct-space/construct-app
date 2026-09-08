package oauth

import (
	"strings"
	"testing"
)

func TestProviderLogoSVG_KnownProviders(t *testing.T) {
	for _, name := range []string{"Claude", "OpenAI", "Gemini", "Construct"} {
		svg := providerLogoSVG(name)
		if svg == "" {
			t.Errorf("providerLogoSVG(%q) returned empty — logo missing from embed FS", name)
		}
		if !strings.Contains(svg, "<svg") {
			t.Errorf("providerLogoSVG(%q) didn't return an <svg> element", name)
		}
	}
}

func TestProviderLogoSVG_Unknown(t *testing.T) {
	if providerLogoSVG("madeuplabel") != "" {
		t.Error("expected empty string for unknown provider")
	}
}

func TestCallbackSuccessHTML_HasKeyParts(t *testing.T) {
	html := CallbackSuccessHTML("Claude")
	wants := []string{
		"<title>Construct — Connected</title>",
		`class="logos"`,                                // three-logo hero row
		`<h1>You're in<span class="dot">.</span></h1>`, // signature title pattern
		`Your Claude account is linked to Construct.`,  // body lead
		`onclick="doClose()"`,                          // close button wiring
		"<svg",                                         // at least one inline logo
		`--accent:#FF2D55`,                             // Construct red accent
	}
	for _, w := range wants {
		if !strings.Contains(html, w) {
			t.Errorf("success page missing %q", w)
		}
	}
}

func TestCallbackErrorHTML_HasKeyParts(t *testing.T) {
	html := CallbackErrorHTML("Gemini", "State mismatch <oops>")
	wants := []string{
		"<title>Construct — Sign-in failed</title>",
		`class="logos"`,
		`<h1>Sign-in failed<span class="dot">.</span></h1>`,
		`Couldn&rsquo;t link Gemini to Construct.`,
		`State mismatch &lt;oops&gt;`, // user-supplied reason is HTML-escaped
		`onclick="doClose()"`,
	}
	for _, w := range wants {
		if !strings.Contains(html, w) {
			t.Errorf("error page missing %q", w)
		}
	}
}
