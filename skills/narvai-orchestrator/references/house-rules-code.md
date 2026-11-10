# House rules — code

Kullanıcının kendi kuralları. Genel prensiplerden ve skill'lerden üstündür.

## ⛔ 2. KURAL: yorum yazma

Uzun `<summary>` blokları, çok satırlı gerekçe yorumları, "TUZAK: …" paragrafları, kodun zaten
söylediğini tekrarlayan açıklamalar YAZILMAZ. Kodu çöplüğe çeviren AI slop bu.

İzinli olan: gerçekten karmaşık bir metotta ya da şaşırtıcı bir davranışta kısa, gerekli bir not. Tek
satır zorunlu değil, kısa olması zorunlu (kullanıcı, 2026-11-11). Gerekçe, ölçüm, değişiklik geçmişi,
"neden böyle yaptım" → koda değil, cevabına ya da plan dosyasına yazılır.

## Pahalıya öğrenilenler

Bu maddeler kullanıcının canını sıkmış gerçek olaylardan. Tekrarı zaman çalmak demek.

1. **Ölçmediğin şeyi söyleme.** "Index kullanılıyor", "çağıranı yok", "düzelttim" — hiçbiri
   ölçülmeden söylenmez. Ölçemediysen "ölçmedim" de. En sert tepki buradan geldi.
2. **Forma alan eklemek bedava değil.** Sunucu üretiyorsa (kod), türetiliyorsa (aile), varsayılanı
   varsa (sıralama), hiçbir yerde okunmuyorsa (açıklama, görsel URL) → forma KONMAZ. Ekleyeceğin
   her alanı "kullanıcı bu soruya cevap vermek zorunda mı?" filtresinden geçir.
3. **İç muhasebe ekranda görünmez.** Provenance blokları, "Seed/Elle" ayrımı, sistem düğümü
   uyarısı, dataset sürümü — kullanıcının işi değil.
4. **`...` menüsü yok.** Her eylem kendi ikonu + tooltip. Hiçbir tabloda üç nokta görmek istemiyor.
5. **Ölü alanı "uyumluluk" diye savunma.** Kaç satırda dolu + kaç yerden okunuyor: ikisi 0 ise
   kolonu da kaldır. Ölçüp söyle, sonra sil.
6. **Cascade tek batch.** Alt ağaç/çoklu satır güncellemesi satır başına commit atmaz; tek
   `SaveChanges`, tek event.
7. **Basit tut, uzatma.** Alternatif tasarım sunma turu değil; ölçüp en yalın olanı yap, gerekçeyi
   tek satırda söyle.

## Coding

1. **Data ≠ code, but not everything is a table.** New element needs new code (branching/adapter
   class) → enum. Has its own lifecycle or is FK-referenced (city, fabric, supplier) → table. Flat,
   unbranched list → keep where it's read; table only if multiple modules read it or it must change
   without a deploy. Never mirror an enum in a lookup table — persist the enum as a string.
2. **No comments** beyond the rule above: a short note on a genuinely complex method or surprising
   behaviour is fine; summaries that restate the code, change history and rationale ("changed because...",
   "used to be...") are not. That is git's and the docs' job.
3. **Clean only what you touch** — no repo-wide sweeps.
4. **No test/dev leftovers.** A stub faking success → delete. A stub that plainly says "not
   implemented" and is unreachable → may stay. Scope like rule 3.
5. **No string comparisons — enums only.**
6. **Second caller → shared module. Single caller → inline.** Test: "would a second caller copy
   this?", not "is this private?".
7. **Open/closed.** Extend, don't edit; a new case forcing a duplicated switch means the design is
   wrong — pick the pattern the actual problem calls for.
8. **Every operation is reversible.**
   - Delete = soft delete, no cascade. Deletable entities inherit the soft-delete base from day one.
   - Hard-delete only: append-only ledgers (DB-enforced) and cache entries (regenerable, expiring). A
     purge job soft-deletes the row and only frees the blob/file.
   - Revert leaves a trail (audit kept, counter-record written); its compensation ships in the same
     piece of work.
   - An irreversible step is a documented, deliberate exception.
9. **A new abstraction/library/layer** needs a named real problem, or it's dropped.
10. **Typed errors** — message built inside a dedicated exception type from structured (enum)
    properties, never a raw string at the throw site.
10a. **İç hata ayrıntısı istemciye GİTMEZ.** Exception message'ı, stack trace'i, veritabanının
    kendi metni (tablo/indeks/kolon adı, `duplicate key … constraint "ix_…"`), SQL, dosya yolu,
    iç servis adresi — hiçbiri response gövdesine konmaz ve ekranda gösterilmez. İstemci sabit bir
    hata **kodu** (`DB_WRITE_FAILED`) ve gerekiyorsa o koda karşılık gelen çevrilmiş bir cümle
    görür. Ayrıntı log'a yazılır; teşhis oradan yapılır. Bir hatayı ayırt edilebilir kılmak
    gerekiyorsa çözüm ham metni sızdırmak değil, yeni bir kod/alan tanımlamaktır.
11. **Dependencies: current version, license-clean — verified, not remembered.**
    AutoMapper/MediatR/MassTransit went commercial Apr 2025 (RPL 1.5, free under $5M revenue);
    FluentAssertions 8.x is Xceed-licensed (7.x stays Apache-2.0).
12. **Parallel workers never generate migrations.** They report the schema need; the coordinator generates
    it on the integration branch after the merge, one context at a time (two parallel migrations on the same
    DbContext collide in the model snapshot). There is no "one migration per feature" requirement.
13. **Don't hand-roll platform features.** Background jobs → Hangfire; HTTP retry/circuit-breaking →
    Polly. Never stack two retry layers.
14. **Check the project's existing libraries/patterns first** — use whatever it already standardized
    on for a concern. Rule 9 applies only once nothing already covers the need.
15. **Varsayılan sıralama: `updated_at DESC, created_at DESC, id DESC`.** Kayıt getiren her liste
    yolu bunu kullanır — en son dokunulan kayıt en üstte. `id` tiebreaker KALDIRILAMAZ: toplu seed
    aynı zaman damgasını yazıyor, onsuz sayfalar arası satır tekrarlanır/atlanır. Hiyerarşi
    listeleri istisna. Oluşturma/güncelleme tarihleri admin tablolarında kolon olarak görünür.
16. **İsimlendirme kuralı `.editorconfig`'den okunur, hatırlanmaz.** Private field `_camelCase`
    ise `static readonly` olan da öyledir — `LoggerMessage.Define` delegate'leri dahil. Bu sınıf
    uyarılar (IDE1006) çoğu projede **build çıktısına düşmez**, yalnız IDE'de görünür: "build
    yeşil" kurala uyulduğu anlamına gelmez. Yeni bir alan/tip adı yazmadan önce `.editorconfig`'i
    aç, ilgili `naming_rule`'u oku.
