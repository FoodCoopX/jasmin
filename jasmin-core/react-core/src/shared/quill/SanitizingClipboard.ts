/**
 * Quill clipboard that sanitizes the HTML it converts.
 *
 * Quill turns HTML — a paste, or the ``value`` an editor is handed — into its
 * own formats after ``normalizeExternalHTML``, whose Word-list normalizer
 * copies each list item's markup into an element of the page's own document
 * through ``innerHTML``. Markup there is live: an ``<img onerror>`` in it
 * runs. So the body is sanitized first, inside the parsed document, which has
 * no browsing context. The ``<html>`` attributes and the head's list styles
 * the normalizer reads are left alone, so a list pasted from Word still
 * converts.
 *
 * Importing this module registers the clipboard for every editor
 * (side-effect).
 */
import DOMPurify from "dompurify";
import type ClipboardModule from "quill/modules/clipboard";
import { Quill } from "react-quill-new";

const Clipboard = Quill.import("modules/clipboard") as typeof ClipboardModule;

class SanitizingClipboard extends Clipboard {
  protected normalizeHTML(doc: Document) {
    doc.body.innerHTML = DOMPurify.sanitize(doc.body.innerHTML);
    super.normalizeHTML(doc);
  }
}

Quill.register("modules/clipboard", SanitizingClipboard, true);
