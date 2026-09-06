/**
 * Общий код доступа к модели: интерфейс и запуск официального клиента.
 *
 * Отдельным пакетом, потому что запускать клиента будет НЕ сервер.
 * Сервер живёт в контейнере, где ни `claude`, ни учётных данных нет;
 * клиент запускает мост на машине владельца подписки (task-001).
 * Интерфейс при этом нужен обеим сторонам, и он обязан быть один.
 */
export { type CliShape, cliProvider } from "./cli.js";
export { KNOWN_CLIENTS } from "./clients.js";
export {
  type Answer,
  type Ask,
  BadAnswerError,
  type Provider,
  ProviderUnavailableError,
} from "./provider.js";
