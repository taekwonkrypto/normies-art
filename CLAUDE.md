# Claude Code Instructions

## Project
Normies Art community tools app. See PLAN.md for full context.

## Structure
- /app — Vite + React app (plain JavaScript, no TypeScript)
- PLAN.md — feature roadmap
- CLAUDE.md — this file

## Workflow
1. **Start of session** — confirm we are on `develop` (`git status`). If not, `git checkout develop`.
2. **After each feature or change** — commit to `develop` and push: `git push origin develop`. Changes are automatically deployed to the preview URL for review — no need to run the app locally.
3. **Preview URL** — https://normies-art-git-develop-tkks-projects-e6c65ea5.vercel.app/
4. **Shipping to production** — only after explicit approval, run:
   ```
   git checkout main
   git merge develop
   git push
   ```
   Always confirm with the user before running these three commands.

## Rules
- No TypeScript
- No UI component libraries — plain CSS or CSS modules
- Keep components small and focused
- API base: https://api.normies.art
- Commit with clear messages after each feature
