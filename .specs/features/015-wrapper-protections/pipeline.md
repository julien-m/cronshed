# Pipeline — Wrapper Protections (single-instance + timeout + timeout-ratio)

**Started:** 2026-04-13 00:00
**Flags:** `--auto`
**Feature Description:** Ajouter deux protections dans le wrapper généré — (1) Single-instance (défaut activé) : flock sur ~/.cronshed/locks/<hash>.lock, skip silencieux avec log {exitCode:0, skipped:true, skippedAt, reason:"already running", pidHolder}, flag --allow-parallel sur cronshed add/update pour désactiver. Le fichier lock est nommé par hash du chemin complet de la tâche. (2) Timeout (opt-in) : --timeout <duration> sur cronshed add/update (ex: --timeout 50s, --timeout 5m), via gtimeout/timeout, vérification à la génération du wrapper (pas à l'exécution), erreur bloquante si absent, timedOut:true dans le log si exit 124, warning non-bloquant si schedule ≤ 1min sans timeout. (3) Config globale timeout-ratio : cronshed config set default-timeout-ratio <0-1> pour appliquer automatiquement un timeout proportionnel à l'intervalle du schedule (ex: 0.8 + */5 → 240s), stocké dans ~/.cronshed/config.json.

| Phase | Status | Completed At |
|-------|--------|--------------|
| Specify | Done | 2026-04-13 |
| Spec Review | Done | 2026-04-13 |
| Plan | Done | 2026-04-13 |
| Plan Review | Done | 2026-04-13 |
| Preflight | Done | 2026-04-13 |
| Implement | Done | 2026-04-13 |
| Test | Done | 2026-04-13 |
