# Phase 1 Implementation Checklist

## Step 1 — Repository Scaffolding
- [ ] Create complete directory structure
- [ ] Add .gitkeep files to empty directories

## Step 2 — Package & Config Files
- [ ] package.json (with pnpm support)
- [ ] tsconfig.json
- [ ] tsup.config.ts
- [ ] .env.example
- [ ] .eslintrc.js (or eslint.config.js)
- [ ] .prettierrc
- [ ] .gitignore
- [ ] .husky/pre-commit
- [ ] .lintstagedrc.js

## Step 3 — Type Definitions
- [ ] src/types/command.ts
- [ ] src/types/event.ts
- [ ] src/types/component.ts
- [ ] src/types/module.ts
- [ ] src/types/discord.d.ts
- [ ] src/types/index.ts

## Step 4 — Custom Error Classes
- [ ] src/errors/BotError.ts
- [ ] src/errors/index.ts

## Step 5 — Config Service
- [ ] src/config/schema.ts
- [ ] src/config/ConfigService.ts

## Step 6 — Logger Service
- [ ] src/services/LoggerService.ts

## Step 7 — Prisma Setup
- [ ] prisma/schema.prisma
- [ ] src/services/DatabaseService.ts

## Step 8 — Cache Service
- [ ] src/services/CacheService.ts

## Step 9 — DI Container
- [ ] src/core/container.ts

## Step 10 — Entry Point
- [ ] src/index.ts

## Verification
- [ ] Run `pnpm run build` (no TypeScript errors)
- [ ] Run `pnpm run lint` (no errors)
- [ ] Run `npx prisma validate`
- [ ] Verify directory structure matches planning doc
- [ ] Verify all type files export correctly
- [ ] Verify all services have @injectable() decorators
- [ ] Verify ConfigService throws on missing env var
- [ ] Verify no `any` type in src/
- [ ] Verify no direct process.env access except ConfigService