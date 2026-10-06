import { describe, expect, it } from "vitest";

import { htmlToText } from "../src/ankiweb/html.js";

describe("htmlToText", () => {
  it("keeps links and images, and turns blocks and list items into lines", () => {
    expect.assertions(1);
    const html = [
      '<p>Read the <a href="https://example.com/guide?a=1&amp;b=2" rel="noopener">manual</a> first.</p>',
      '<img src="https://example.com/front.jpg">',
      "<p><strong>Key features</strong></p>",
      "<ul>",
      "<li>Starts from zero</li>",
      "<li>Uses <em>real</em> anime &amp; dorama</li>",
      "</ul>",
      "<p>Line one<br>line two</p>",
    ].join("\n");
    expect(htmlToText(html)).toBe(
      [
        "Read the [manual](https://example.com/guide?a=1&b=2) first.",
        "",
        "![](https://example.com/front.jpg)",
        "",
        "Key features",
        "",
        "- Starts from zero",
        "- Uses real anime & dorama",
        "",
        "Line one",
        "line two",
      ].join("\n"),
    );
  });

  it("passes plain text through", () => {
    expect.assertions(1);
    expect(htmlToText("First line\nSecond line")).toBe("First line\nSecond line");
  });

  it("decodes numeric entities and leaves unknown ones alone", () => {
    expect.assertions(1);
    expect(htmlToText("&#39;a&#x27; &copy; &#99999999;")).toBe("'a' &copy; &#99999999;");
  });
});
