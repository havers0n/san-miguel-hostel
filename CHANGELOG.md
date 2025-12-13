# Changelog

Все значимые изменения в проекте документируются в этом файле.

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.0.0/),
и проект придерживается [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added
- (пусто)

## [0.1.0] - 2025-12-13

### Added

#### Engine Core
- Fixed-step loop с max accum и обработкой dropped ticks
- Runtime с bounded буферами (decisionBuffer, commandBuffer, queue)
- TTL-множество для exactly-once гарантий по intentId
- Atomic drains для decision и command буферов
- Fair backpressure queue с приоритетом по агенту
- Scheduler API с allowlist для изоляции мутаций runtime
- Scheduler с intent planning и управлением очередью
- Async decision worker transport для изоляции AI-вызовов
- Inflight lifecycle: tracking, cleanup, timeout handling
- Exactly-once decision ingestion с фильтрацией по requestId, intentId, contextHash
- Transactional tick pipeline над WorldOps (drain → filter → applyDecisions → reduceCommands → step)
- Engine events ring для диагностики (SIM_DROPPED_TICKS, AI_BACKPRESSURE, AI_RESULT_DISCARDED)

#### World
- WorldOps adapter над существующим доменом
- Стабилизированный context hash для engine decisions
- Event delta slicing без зависимости от engine Command

#### App
- Интеграция детерминированного engine loop с worker
- UI snapshot strategy (worldRef + throttled snapshots)

#### Headless
- Deterministic clock injection в WorldOps
- Headless runner для прогона симуляции без UI

#### Docs
- ARCHITECTURE.md с описанием архитектуры движка
- Project Rules (Engine Contract) в README.md
- referense.md с референс-костяком архитектуры

### Fixed

#### Engine
- Worker учитывает глобальные inflight slots и защищает очистку inflight
- Очистка inflight при discards и обработка invalid_shape
- Батчинг inflight timeout events и защита удаления inflight
- Установка inflight только при успешной постановке в очередь

#### World
- Усиление event delta slicing и удаление зависимости от engine Command
- Стабилизация context hash для engine decisions
