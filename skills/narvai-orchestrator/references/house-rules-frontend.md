# House rules — frontend

Conservative look, non-repeating code — matching the design never excuses copying a component.

1. Shared component library only; extend with a prop, never fork. An existing page-local copy moves
   to shared the moment you touch that page.
2. CSS from tokens/utilities only, no raw values; verify a class exists before using it.
3. One service module per backend resource; components never call HTTP directly.
4. Types mirror the real (server) contract, not the plan doc.
5. No mock data in page code — real data or an empty state, never a plausible fake.
6. Fix stale contracts the moment you touch that screen — don't layer new on old.
7. Cache slow-changing reference data via `Cache-Control` + a data-derived `ETag`/304, not by hand and
   never by mirroring server data into localStorage/sessionStorage.
8. **UI text names things; it doesn't narrate them.** No standing subtitles, mechanism explainers, or
   example chips — a constraint surfaces only when it's hit (the error, the disabled state). Error
   messages, conditional warnings, empty states, and loading text stay; anything that just restates
   what's already visible goes. Apply this proactively to every file you touch, including pre-existing
   standing captions/warnings you didn't write — don't wait to be told about each one individually;
   convert (rule 9) or delete on sight.
9. **A genuinely useful explainer lives behind an info icon + hover tooltip, never a standing
   paragraph.** Existing tooltip primitive first, no reinventing one. No AI slop: one or two plain
   sentences saying exactly what it does — no filler, no restating the label, no hedging.
9a. **Onay/uyarı metni KISA ve GENEL olur — iç mekanizma anlatılmaz.** Kullanıcıya ne olacağı bir
    cümlede söylenir, geri alınamazsa ikinci kısa cümlede belirtilir: *"Kumaşı silmek istediğinize
    emin misiniz? Bu işlem geri alınamaz."* Denetim izi, soft delete, hangi tablonun ne olacağı,
    "geri getirmek bir yöneticinin işidir", nelerin cascade sileceğinin listesi → hiçbiri yazılmaz;
    bunlar iç muhasebedir ve ekranda AI slop gibi okunur. Üç cümlelik gerekçe paragrafı yazdığını
    fark ettiğin an sil. Aynısı toast, boş durum ve hata metinleri için de geçerli.
9b. **Form doğrulaması ALAN ALTINDA gösterilir — istisnasız.** Her form React Hook Form + Zod
    ile kurulur; her alanın altında kendi hata metni durur. Hata **toast'a atılmaz**: toast köşede
    kaybolur ve hangi kutunun yanlış olduğunu söylemez. Sunucudan gelen alan hataları da (`fields`)
    ilgili alana yazılır — alan adı PascalCase gelir, camelCase'e çevrilmeden hiçbir alana oturmaz
    ve sessizce kaybolur. Elle `useState` ile form kurup doğrulamayı atlamak, bu kuralın ihlalidir.
10. Verify with the language server, not memory — and confirm the lint script actually lints.
11. **Sıralama alanı forma KONMAZ** — söylenmedikçe. Kullanıcı bir kayıt eklerken "kaçıncı sırada
    duracak" sorusuna cevap vermek zorunda değil; alan boş bırakılıp arkada varsayılan (0) geçer.
    Sıralama tablonun işi: ileride ortak admin table component'ine header satırından ok ikonuyla
    ilgili kolona göre sıralama eklenecek. Aynı mantık kayıt kimliği (kod) için de geçerli —
    sunucu üretiyorsa forma konmaz.
12. **The first pass ships finished** (user, 2026-11-11: the screen must be right without listing every
    detail). Before writing a page, dialog, form or component, write down in four lines:
    - the page pattern (archetype) from the design docs the project profile names;
    - the one primary action;
    - the states: loading, empty, error, no permission, disabled, long text, many rows;
    - the ~344 px layout: side panels stack or become a drawer, a table scrolls inside its own box, no page-level
      horizontal scroll, touch-size controls.

    Before calling the slice done, check it:
    - the project design skill's review list, item by item;
    - the 344 px layout and desktop at full width;
    - the "Refuse" list in `impeccable`'s `reference/craft-floor.md` (identical icon-card grids, hero-metric
      tiles, labels above headings, gradient text, decorative glass, emoji as icons);
    - keyboard: tab order, Enter submits, Esc closes, visible focus.

    Fix what fails before reporting. If nobody looked at the render, say so.
