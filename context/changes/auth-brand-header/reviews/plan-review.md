<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Opcjonalny brand-header (logo) na odsłonach auth

- **Plan**: context/changes/auth-brand-header/plan.md
- **Mode**: Deep
- **Date**: 2026-07-14
- **Verdict**: SOUND (after fixes)
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING (fixed) |

## Grounding

9/9 paths ✓, 3/3 symbols ✓ (Topbar brand-link Topbar.astro:29, Logo variant="full" default, all 5 auth pages showTopbar={false}), brief↔plan ✓. No docs/reference/contract-surfaces.md (skipped). Progress↔Phase consistency ✓ (P1 1.1–1.8, P2 2.1–2.7).

## Findings

### F1 — Verification 1.4 `grep -l "brand"` jest wakacyjny (false-positive)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 — Automated 1.4
- **Detail**: Każda strona auth ma już `text-brand-700` w `<h1>`, więc słowo "brand" jest obecne niezależnie od zmiany. `grep -l "brand" src/pages/auth/*.astro` przechodzi wakacyjnie i nie weryfikuje faktycznego dodania propu.
- **Fix**: Zmienić na wzorzec atrybutu: `grep -lE "showTopbar=\{false\} brand" src/pages/auth/*.astro` (5 trafień).
- **Decision**: FIXED (zaktualizowano Phase 1 Automated + Progress 1.4)

### F2 — Asercja „brak nav Topbara" opiera się na proxy (link „Katalog")

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Changes Required #1
- **Detail**: `getByRole("link", {name:"Katalog"}).count()===0` jako dowód „brak Topbara" to dobry dyskryminator (tylko Topbar renderuje „Katalog"; „Zaloguj się"/„Zarejestruj się" to krzyżowe linki auth). Warto to uzasadnić w komentarzu testu, by przyszła zmiana copy nie wyglądała na przypadkową.
- **Fix**: Dodać jednozdaniowy komentarz w spec uzasadniający wybór „Katalog".
- **Decision**: FIXED (dodano wymóg komentarza w kontrakcie Phase 2 #1)
