package main

import (
	"net/url"
	"strings"
)

type jsTextEdit struct {
	start, end int
	value      string
}

func rewriteJavaScript(source string, base *url.URL) string {
	if base == nil || source == "" {
		return source
	}
	edits := make([]jsTextEdit, 0, 4)
	for i := 0; i < len(source); {
		switch source[i] {
		case '\'', '"':
			i = skipJSQuoted(source, i, source[i])
			continue
		case 96:
			i = skipJSTemplate(source, i)
			continue
		case '/':
			if next, ok := skipJSComment(source, i); ok {
				i = next
				continue
			}
		}
		if !isJSIdentifierStart(source[i]) {
			i++
			continue
		}
		start := i
		i++
		for i < len(source) && isJSIdentifierPart(source[i]) {
			i++
		}
		keyword := source[start:i]
		if keyword != "import" && keyword != "export" {
			continue
		}
		specStart, specEnd, ok := findJSModuleSpecifier(source, i, keyword == "import")
		if !ok || specEnd <= specStart+1 {
			continue
		}
		raw := source[specStart+1 : specEnd-1]
		if !isRewritableModuleSpecifier(raw) {
			continue
		}
		rewritten := proxiedURL(raw, base)
		if rewritten == "" {
			continue
		}
		edits = append(edits, jsTextEdit{start: specStart + 1, end: specEnd - 1, value: rewritten})
		i = specEnd
	}
	if len(edits) == 0 {
		return source
	}
	var out strings.Builder
	out.Grow(len(source) + len(edits)*64)
	last := 0
	for _, edit := range edits {
		if edit.start < last || edit.end > len(source) {
			continue
		}
		out.WriteString(source[last:edit.start])
		out.WriteString(edit.value)
		last = edit.end
	}
	out.WriteString(source[last:])
	return out.String()
}

func findJSModuleSpecifier(source string, after int, isImport bool) (int, int, bool) {
	i := skipJSTrivia(source, after)
	if i >= len(source) {
		return 0, 0, false
	}
	if isImport {
		switch source[i] {
		case '.':
			return 0, 0, false
		case '(':
			i = skipJSTrivia(source, i+1)
			return readJSStringLiteral(source, i)
		case '\'', '"':
			return readJSStringLiteral(source, i)
		}
	}
	depth := 0
	for i < len(source) {
		switch source[i] {
		case '\'', '"':
			i = skipJSQuoted(source, i, source[i])
			continue
		case 96:
			i = skipJSTemplate(source, i)
			continue
		case '/':
			if next, ok := skipJSComment(source, i); ok {
				i = next
				continue
			}
		case '{', '(', '[':
			depth++
			i++
			continue
		case '}', ')', ']':
			if depth > 0 {
				depth--
			}
			i++
			continue
		case ';':
			if depth == 0 {
				return 0, 0, false
			}
		case '\n', '\r':
			if depth == 0 {
				return 0, 0, false
			}
		}
		if isJSIdentifierStart(source[i]) {
			start := i
			i++
			for i < len(source) && isJSIdentifierPart(source[i]) {
				i++
			}
			if depth == 0 && source[start:i] == "from" {
				i = skipJSTrivia(source, i)
				return readJSStringLiteral(source, i)
			}
			continue
		}
		i++
	}
	return 0, 0, false
}

func readJSStringLiteral(source string, start int) (int, int, bool) {
	if start >= len(source) || (source[start] != '\'' && source[start] != '"') {
		return 0, 0, false
	}
	end := skipJSQuoted(source, start, source[start])
	if end <= start+1 || end > len(source) || source[end-1] != source[start] {
		return 0, 0, false
	}
	if strings.Contains(source[start+1:end-1], "\\") {
		return 0, 0, false
	}
	return start, end, true
}

func skipJSTrivia(source string, i int) int {
	for i < len(source) {
		if source[i] == ' ' || source[i] == '\t' || source[i] == '\n' || source[i] == '\r' || source[i] == '\f' {
			i++
			continue
		}
		if next, ok := skipJSComment(source, i); ok {
			i = next
			continue
		}
		break
	}
	return i
}

func skipJSQuoted(source string, start int, quote byte) int {
	for i := start + 1; i < len(source); i++ {
		switch source[i] {
		case '\\':
			i++
		case quote:
			return i + 1
		case '\n', '\r':
			return i
		}
	}
	return len(source)
}

func skipJSTemplate(source string, start int) int {
	for i := start + 1; i < len(source); i++ {
		switch source[i] {
		case '\\':
			i++
		case 96:
			return i + 1
		}
	}
	return len(source)
}

func skipJSComment(source string, start int) (int, bool) {
	if start+1 >= len(source) || source[start] != '/' {
		return start, false
	}
	switch source[start+1] {
	case '/':
		i := start + 2
		for i < len(source) && source[i] != '\n' && source[i] != '\r' {
			i++
		}
		return i, true
	case '*':
		if end := strings.Index(source[start+2:], "*/"); end >= 0 {
			return start + 2 + end + 2, true
		}
		return len(source), true
	default:
		return start, false
	}
}

func isJSIdentifierStart(v byte) bool {
	return v == '$' || v == '_' || v >= 'a' && v <= 'z' || v >= 'A' && v <= 'Z'
}

func isJSIdentifierPart(v byte) bool { return isJSIdentifierStart(v) || v >= '0' && v <= '9' }

func isRewritableModuleSpecifier(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	if strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") || strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") {
		return true
	}
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}
