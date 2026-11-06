package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestRewriteJavaScriptLeavesImportTextInsideStringsUntouched(t *testing.T) {
	base, _ := url.Parse("https://www.youtube.com/s/desktop/app.js")
	source := `function mc(){if(e.getAttribute("rel")==="import"){return "import 'fake.js'";}};`
	got := rewriteJavaScript(source, base)
	if got != source {
		t.Fatalf("ordinary JavaScript string contents were rewritten:\n%s", got)
	}
}

func TestRewriteJavaScriptRewritesOnlyActualModuleSpecifiers(t *testing.T) {
	base, _ := url.Parse("https://example.test/app/main.js")
	source := `import "./side-effect.js";
import { value } from "../lib/value.js";
const lazy = import("./lazy.js");
export { thing } from "https://cdn.example.test/thing.js";
const label = "import './not-a-module.js' and export from";
const bare = import("react");
const meta = import.meta.url;`
	got := rewriteJavaScript(source, base)
	for _, expected := range []string{
		`/proxy?url=https%3A%2F%2Fexample.test%2Fapp%2Fside-effect.js`,
		`/proxy?url=https%3A%2F%2Fexample.test%2Flib%2Fvalue.js`,
		`/proxy?url=https%3A%2F%2Fexample.test%2Fapp%2Flazy.js`,
		`/proxy?url=https%3A%2F%2Fcdn.example.test%2Fthing.js`,
		`const label = "import './not-a-module.js' and export from";`,
		`import("react")`,
		`import.meta.url`,
	} {
		if !strings.Contains(got, expected) {
			t.Fatalf("rewritten JavaScript missing %q:\n%s", expected, got)
		}
	}
}
