/**
 * Ссылки описания API (OpenAPI `links`, task-120): что можно сделать с только
 * что заведённым. По ним Schemathesis проходит цепочки «завёл → прочитал →
 * изменил → удалил» с настоящим идентификатором, а не с выдуманным.
 *
 * Ссылка стоит у двери, которая заводит, — рядом с тем, что она отдаёт.
 * Цель названа путём и методом; дверь, которой нет, роняет `npm run openapi`
 * (`tools/checks/openapi.mjs`), а не остаётся битой ссылкой.
 */
export interface DoorLink {
  operationRef: string;
  parameters: Record<string, string>;
}

/** Номер из тела ответа — по умолчанию его поле `id`. */
const CREATED_ID = "$response.body#/id";

function linkTo(method: string, path: string, id = CREATED_ID): DoorLink {
  // JSON Pointer (RFC 6901): «~» и «/» внутри имени экранируются.
  const pointer = path.replaceAll("~", "~0").replaceAll("/", "~1");
  return { operationRef: `#/paths/${pointer}/${method.toLowerCase()}`, parameters: { id } };
}

/** Ссылки одним списком: имя ссылки — метод и путь, читать их в описании удобно. */
export function linksTo(...doors: Array<[method: string, path: string]>): Record<string, DoorLink> {
  return Object.fromEntries(
    doors.map(([method, path]) => [
      `${method} ${path}`.replace(/[^A-Za-z0-9._-]/gu, "_"),
      linkTo(method, path),
    ]),
  );
}
