/**
 * Деление дверей фаззера на куски (task-123): ни одна дверь не теряется.
 *
 * ⚠️ ДВА ГЛАВНЫХ СВОЙСТВА. Объединение кусков равно прогону целиком: кусок молча
 * без одной двери выглядел бы так же зелено, как полный. И у каждой связи описания
 * оба конца в одном куске: фазы 1–3 берут данные из ответов других дверей, и
 * разрезанная связь дала бы потребителю выдуманные номера — мельче, но зелено.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { EXCLUDED, familyOf, pathsOf, shards } from "./fuzz-shards.mjs";

const spec = JSON.parse(readFileSync(new URL("../../backend/openapi.json", import.meta.url)));
const all = pathsOf(spec);

describe("куски фаззера", () => {
  for (const count of [1, 2, 4, 7]) {
    it(`${count}: не пересекаются и вместе дают все двери прогона`, () => {
      const pieces = shards(all, count);
      const flat = pieces.flat();
      assert.equal(new Set(flat).size, flat.length, "путь попал в два куска");
      assert.deepEqual([...flat].sort(), all.map((one) => one.path).sort());
    });
  }

  it("у каждой связи описания оба конца в одном куске", () => {
    const pieces = shards(all, 4);
    const pieceOf = new Map(pieces.flatMap((piece, at) => piece.map((path) => [path, at])));
    const links = Object.entries(spec.paths).flatMap(([from, item]) =>
      Object.values(item).flatMap((operation) =>
        Object.values(operation?.responses ?? {}).flatMap((response) =>
          Object.values(response.links ?? {}).map((link) => {
            const pointer = decodeURIComponent(link.operationRef.replace("#/paths/", ""));
            const to = pointer.slice(0, pointer.lastIndexOf("/")).replaceAll("~1", "/");
            return [from, to];
          }),
        ),
      ),
    );
    assert.ok(links.length > 0, "в описании нет связей — проверять нечего");
    for (const [from, to] of links) {
      assert.equal(pieceOf.get(from), pieceOf.get(to), `связь ${from} → ${to} разрезана`);
    }
  });

  it("путь с номером в одном куске с дверью, что этот номер выдаёт", () => {
    assert.equal(familyOf("/v1/messages/{id}/pin"), familyOf("/v1/conversations"));
    assert.equal(familyOf("/v1/invites/{id}"), familyOf("/v1/auth/join"));
    assert.equal(familyOf("/v1/bridge/join"), familyOf("/v1/bridges"));
  });

  it("одни и те же куски на любой машине", () => {
    assert.deepEqual(shards([...all].reverse(), 4), shards(all, 4));
  });

  it("каждое исключение — настоящая дверь описания, а не опечатка", () => {
    for (const one of EXCLUDED) assert.ok(spec.paths[one.path], `нет пути ${one.path}`);
  });

  it("исключённых дверей в кусках нет", () => {
    const flat = shards(all, 4).flat();
    for (const one of EXCLUDED) assert.ok(!flat.includes(one.path), one.path);
  });
});
