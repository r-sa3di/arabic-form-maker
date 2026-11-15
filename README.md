# Arabic PDF Form Maker

<p dir="rtl" lang="ar">أداة مجانية لتحويل ملفات PDF العربية إلى نماذج قابلة للتعبئة: حقول نصية من اليمين إلى اليسار، مربعات اختيار، وأزرار اختيار. تعمل داخل المتصفح دون تثبيت، ويبقى ملفك على جهازك.</p>

Arabic PDF Form Maker turns an ordinary PDF into a fillable PDF form that people can complete on screen. You open your PDF, mark where the answers go, and save a new copy with text fields, checkboxes and radio buttons. It is made for Arabic documents: text typed into the fields is right-to-left (RTL) and uses an Arabic font.

- **Free**, and nothing to install. It is one file that opens in your web browser.
- **Private.** Your PDF stays on your computer. Nothing is uploaded, and it works without an internet connection.
- **Your page is not changed.** The tool only adds fields on top of it.

## Get the tool

1. Open the **[latest release](https://github.com/r-sa3di/arabic-pdf-form-maker/releases/latest)**.
2. Under **Assets**, click **`Arabic.PDF.Form.Maker.html`** to download it.
3. Open the downloaded file by double-clicking it. It opens in your web browser. Use Chrome or Edge on a computer; the tool is not made for phones.

Keep the file anywhere you like. You can open it again whenever you need it.

## Make your first form

1. Click **Open PDF…** and choose your PDF, or drag the PDF onto the page.
2. Add fields (see the next section). The quickest start is **Suggest fields**, which looks for empty boxes, small squares, circles and dotted lines on the page and places fields on them. Check each suggestion and delete the wrong ones.
3. Use **‹** and **›** to move between pages, and **−** / **+** to zoom.
4. Click **Save fillable PDF**. The new file is saved to your Downloads folder with `_fillable` added to its name. Your original PDF is not touched.
5. Open the new file in a PDF viewer and try filling it in before you send it to anyone.

## The fields you can add

| Field | Use it for | How to add it |
| --- | --- | --- |
| **Text field** | Names, dates, any typed answer | Click **+ Text field**, then drag a rectangle where the answer goes |
| **Checkbox** | Questions where several answers can be ticked | Click **+ Checkbox**, then click each spot |
| **Radio group** | Questions with only one answer (for example Yes / No) | Click **+ Radio group**, then click each answer of that one question. Click **+ Radio group** again before starting the next question |

Click **Select** (or press `Esc`) when you have finished adding. In Select mode you can click a field, drag it to move it, and drag its corners to resize it.

### Radio groups in more detail

Radio buttons work as a group: ticking one answer clears the others. So the tool needs to know which buttons belong to the same question.

- Each time you click **+ Radio group**, you start a new question. Every click after that adds one answer to it.
- You can also click a checkbox or radio button that is already on the page to move it into the question you are building. This is the fast way to group the circles found by **Suggest fields**.
- Buttons in the same group show the same label next to them (G1, G2, …). Selecting one highlights the others.
- A group needs at least two buttons. A group with one button cannot be un-ticked once it is ticked.

## Settings for a selected field

Click a field to see its settings in the panel on the right.

| Setting | What it does |
| --- | --- |
| **Type** | Change the field between text, checkbox and radio button |
| **Group** | Move a checkbox or radio button into another group, or a new one |
| **Answers allowed** | Switch a whole group between **One** answer (radio buttons) and **Several** (checkboxes) |
| **Add more boxes to this group** | Continue adding answers to this group |
| **Mark** | The mark shown when ticked: tick, cross or dot |
| **Draw the box outline** | Draws the square or circle itself. Leave it on when the page has no printed box at that spot; turn it off when the page already shows one |
| **Allow several lines** | For a text field that should hold a paragraph |
| **Left-to-right** | For phone numbers, ID numbers and email addresses |
| **Required** | Shows a red outline around the field so people know it must be filled in |
| **Text size** | Size of the typed text. **Auto** fits the text to the field |
| **Tooltip** | A short hint that appears when the mouse rests on the field |
| **Delete field** | Removes the field |

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `T` | Add text fields |
| `C` | Add checkboxes |
| `R` | Start a new radio group |
| `V` or `Esc` | Back to Select |
| `Delete` | Remove the selected field |
| Arrow keys | Move the selected field a little (`Shift` + arrow for bigger steps) |
| `Ctrl` + `D` | Duplicate the selected field |
| `Ctrl` + `Z` | Undo |

## PDFs that already have fields

If your PDF already contains fillable fields, the tool shows them with a striped, dashed outline. You can move them, resize them, change their tooltip and mark them Required. Their type and look stay as they are, and they cannot be deleted. Dropdown lists, signature boxes and buttons are shown in grey and cannot be changed.

## What the person filling the form will see

The saved form behaves a little differently in each PDF viewer. Test in the ones your readers use.

| Viewer | What to expect |
| --- | --- |
| **Adobe Acrobat Reader** (computer) | Everything works. Boxes look clean, with no coloured background |
| **Chrome and Edge** | Everything works. The browser adds its own light-blue highlight behind every field. This cannot be switched off from inside a PDF; it is how these browsers show that something can be filled in |
| **Phones and tablets** | Checkboxes and radio buttons work. Arabic text typed into text fields may not display correctly, because most phone apps do not run the small script that arranges Arabic letters |

## Questions and problems

**The radio button looks like an oval, or the blue highlight is wider than the circle.**
The circle is always round, but the field around it can be wider than tall if you dragged it that way. Click instead of dragging when adding radio buttons, or resize the field to be roughly square.

**"Suggest fields" missed a box, or added one where there is none.**
It is a helper, not a guarantee. Add missing fields by hand and delete wrong ones. On very large pages it can miss small boxes.

**Suggest found my circles but they do not work together.**
Each detected circle starts on its own, because the tool cannot know which circles belong to the same question. Click **+ Radio group**, then click the circles of one question.

**A box I added is invisible in Acrobat until I click it.**
Select it and turn on **Draw the box outline**.

**The PDF will not open.**
Password-protected PDFs must have the password removed first.

**The fields are in the wrong place after saving.**
This can happen on pages that are rotated inside the PDF. The tool warns you when it opens such a page.

**The PDF was digitally signed.**
Adding or changing fields makes the existing signature invalid. The tool warns you when you save.

**Can people be stopped from saving an empty Required field?**
No. Required is a visible red outline and a flag in the file; PDF viewers do not reliably enforce it.

## For developers

The HTML file is the whole tool and the source of truth; there is no build step. It embeds PDF.js (to display pages), pdf-lib (to write the PDF) and the font.

Run the tests with Node.js:

```sh
node tests/core.test.js
```

The tests load the bundled pdf-lib and the tool's core code from the HTML file. They cover input checking, radio group structure, the drawing commands for marks and outlines, editing fields that were already in a PDF (including names such as `form.name`, tooltips stored on a group, and fields shown in several places), repeat processing without duplicate fonts or name collisions, and circle and square detection. The user-interface script is only compiled by these tests, not run, so editor behavior has to be checked in a browser.

Technical notes:

- New checkboxes and radio buttons are native PDF form fields with their own drawn appearances; they do not depend on scripts.
- Right-to-left text fields depend on a small formatting script in every viewer.
- A checkbox group is a set of separate checkbox fields with a shared name prefix. It is not a PDF list box.
- Tooltip and Required belong to a field, not to one box on the page. A radio group, or an existing field that appears in several places, has one of each.
- When a save only edits fields that were already in the PDF, nothing else is added to the file: no font, no scripts, no default settings.
- PDF.js is run with `isEvalSupported: false`. Values from the editor are checked before they are written into the PDF.

## License

Arabic PDF Form Maker is released under the MIT License (see `LICENSE`). The embedded third-party components keep their own licenses; see `THIRD-PARTY-NOTICES.md` and the `licenses/` folder.
