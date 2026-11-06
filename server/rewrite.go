package main

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"github.com/PuerkitoBio/goquery"
	"net/url"
	"regexp"
	"strings"
)

//go:embed bridge.js
var bridgeSource string

var (
	cssURLPattern     = regexp.MustCompile(`(?i)url\(\s*(['"]?)(.*?)['"]?\s*\)`)
	cssImportPattern  = regexp.MustCompile(`(?i)(@import\s+)(['"])([^'"]+)(['"])`)
	refreshURLPattern = regexp.MustCompile(`(?i)(url\s*=\s*)(['"]?)([^;'"]+)(['"]?)`)
)

func (a *app) rewriteHTML(data []byte, base *url.URL) ([]byte, error) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	selector := "a[href], area[href], link[href], script[src], img[src], source[src], video[src], audio[src], track[src], iframe[src], frame[src], embed[src], object[data], form[action], input[src], button[formaction], input[formaction], [poster], [srcset], [style], [xlink\\:href]"
	doc.Find(selector).Each(func(_ int, s *goquery.Selection) {
		for _, attr := range []string{"href", "src", "action", "formaction", "poster", "data", "xlink:href"} {
			if value, ok := s.Attr(attr); ok {
				if rewritten := proxiedURL(value, base); rewritten != "" {
					s.SetAttr(attr, rewritten)
				}
			}
		}
		if value, ok := s.Attr("srcset"); ok {
			s.SetAttr("srcset", rewriteSrcset(value, base))
		}
		if value, ok := s.Attr("style"); ok {
			s.SetAttr("style", rewriteCSS(value, base))
		}
		s.RemoveAttr("integrity")
	})
	doc.Find("base").Remove()
	doc.Find("meta[http-equiv='Content-Security-Policy'], meta[http-equiv='Content-Security-Policy-Report-Only']").Remove()
	doc.Find("meta[http-equiv='refresh']").Each(func(_ int, s *goquery.Selection) {
		content, ok := s.Attr("content")
		if !ok {
			return
		}
		s.SetAttr("content", refreshURLPattern.ReplaceAllStringFunc(content, func(match string) string {
			p := refreshURLPattern.FindStringSubmatch(match)
			if len(p) < 5 {
				return match
			}
			return p[1] + "\"" + proxiedURL(p[3], base) + "\""
		}))
	})
	doc.Find("style").Each(func(_ int, s *goquery.Selection) { s.SetText(rewriteCSS(s.Text(), base)) })
	doc.Find("script[type='module']:not([src])").Each(func(_ int, s *goquery.Selection) { s.SetText(rewriteJavaScript(s.Text(), base)) })
	original, _ := json.Marshal(base.String())
	bootstrap := "<script>window.__NORAV_ORIGINAL_URL__=" + string(original) + ";window.parent.postMessage({type:\"norav:navigation\",url:window.__NORAV_ORIGINAL_URL__},\"*\");</script><script>" + bridgeSource + "</script>"
	if doc.Find("head").Length() > 0 {
		doc.Find("head").First().PrependHtml(bootstrap)
	} else {
		doc.Find("html").First().PrependHtml("<head>" + bootstrap + "</head>")
	}
	html, err := doc.Html()
	if err != nil {
		return nil, err
	}
	return []byte("<!doctype html>\n" + html), nil
}

func proxiedURL(raw string, base *url.URL) string {
	value := strings.TrimSpace(raw)
	if value == "" || strings.HasPrefix(value, "#") {
		return ""
	}
	lower := strings.ToLower(value)
	for _, prefix := range []string{"data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "intent:"} {
		if strings.HasPrefix(lower, prefix) {
			return ""
		}
	}
	target, err := url.Parse(value)
	if err != nil {
		return ""
	}
	target = base.ResolveReference(target)
	if target.Scheme != "http" && target.Scheme != "https" {
		return ""
	}
	proxy := url.URL{Path: "/proxy"}
	q := url.Values{}
	q.Set("url", target.String())
	proxy.RawQuery = q.Encode()
	return proxy.String()
}

func rewriteSrcset(value string, base *url.URL) string {
	if strings.Contains(strings.ToLower(value), "data:") {
		return value
	}
	parts := strings.Split(value, ",")
	for i, part := range parts {
		f := strings.Fields(part)
		if len(f) == 0 {
			continue
		}
		if rewritten := proxiedURL(f[0], base); rewritten != "" {
			f[0] = rewritten
			parts[i] = strings.Join(f, " ")
		}
	}
	return strings.Join(parts, ", ")
}

func rewriteCSS(value string, base *url.URL) string {
	value = cssURLPattern.ReplaceAllStringFunc(value, func(match string) string {
		p := cssURLPattern.FindStringSubmatch(match)
		if len(p) < 3 {
			return match
		}
		target := proxiedURL(p[2], base)
		if target == "" {
			return match
		}
		return "url(\"" + strings.ReplaceAll(target, "\"", "\\\"") + "\")"
	})
	return cssImportPattern.ReplaceAllStringFunc(value, func(match string) string {
		p := cssImportPattern.FindStringSubmatch(match)
		if len(p) < 5 {
			return match
		}
		target := proxiedURL(p[3], base)
		if target == "" {
			return match
		}
		return p[1] + "\"" + target + "\""
	})
}
