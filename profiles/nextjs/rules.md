# Next.js rules

- Use the shared component library; extend a component with a prop, never fork it. A page-local copy moves to the shared library when you touch that page.
- Styles come from the design tokens and utilities only, no raw values. Check that a class or token exists before using it.
- One service module per backend resource; components never call HTTP directly.
- Types mirror the real server contract, generated from its schema, never a plan document. Generated files are never edited by hand.
- No mock data in page code: real data or an empty state, never a plausible fake.
- Slow-changing reference data is cached with HTTP caching (`Cache-Control` and an `ETag`), never mirrored into localStorage or sessionStorage.
- UI text names things; it does not narrate them. No standing subtitles, mechanism explainers or internal bookkeeping (provenance, versions, sources) on screen. A constraint shows when it is hit.
- A useful explanation goes behind an info icon with a tooltip, using the existing tooltip primitive.
- Confirmations, toasts and empty states are one or two short sentences: what will happen, and whether it can be undone.
- No `...` overflow menu: each action has its own icon with a tooltip.
- Form validation errors show under their field, never only in a toast. Server field errors are mapped onto the fields (check the casing of the names).
- A field the server generates or defaults (code, sort order) is not in the form.
- Before writing a page, dialog, form or component, write down: the page pattern, the one primary action, the states (loading, empty, error, no permission, long text, many rows), and the narrow-phone layout.
- Before calling a screen done: narrow phone and full desktop width, no page-level horizontal scroll, keyboard (tab order, Enter submits, Esc closes, visible focus). If nobody looked at the render, say so.
- Check names and types with the language server, not memory, and confirm that the lint script actually lints.
