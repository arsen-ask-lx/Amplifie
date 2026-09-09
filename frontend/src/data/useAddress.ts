import { useMemo, useRef } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";

/**
 * Где человек находится и куда мы его ведём.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `useChat` ПО ЗНАНИЮ, А НЕ ПО РАЗМЕРУ (Д-10). Адрес
 * отвечает на вопрос «что открыто и на что смотреть»; лента — на вопрос
 * «что показывать». Смешанные, они читались только целиком: правка
 * в списке каналов начиналась с чтения семисот строк про догон.
 *
 * Состояния здесь нет вовсе — всё выводится из адреса. Это и есть
 * причина, по которой шов проходит именно тут: адрес уже является
 * единственным источником правды о том, что открыто, и хранить это
 * рядом с ним вторым способом было бы двумя ответами на один вопрос.
 */

/**
 * Куда смотреть в ленте. Каждый переход рождает НОВЫЙ объект, даже если
 * поля те же: по его смене лента понимает, что надо подсветить реплику
 * заново.
 */
export interface Focus {
  conversationId: string;
  seq: number;
}

export interface Address {
  /** Какой разговор открыт. `null` — ни одного. */
  currentId: string | null;
  /**
   * То же самое ссылкой — для эффектов, которым нельзя перезапускаться
   * на каждом переходе.
   */
  currentIdRef: React.RefObject<string | null>;
  /** Номер реплики из адреса — переход по цитате. */
  wanted: number | null;
  focus: Focus | null;
  /** Мы на голом «/» — только там уместно подставить разговор по умолчанию. */
  atRootRef: React.RefObject<boolean>;
  /** Перейти. Тот же `navigate`, что у роутера, — своего не заводим. */
  navigate: ReturnType<typeof useNavigate>;
}

export function useAddress(): Address {
  /**
   * ⚠️ `useMatch`, А НЕ `useParams`. Параметры адреса нужны в хуке,
   * который зовётся ВЫШЕ любого `<Route>`. `useParams` в таком месте
   * молча вернул бы пустоту — и разговор не открывался бы вовсе.
   */
  const atSeq = useMatch("/c/:conversationId/:seq");
  const atRoom = useMatch("/c/:conversationId");
  const location = useLocation();
  const navigate = useNavigate();

  const currentId = atSeq?.params.conversationId ?? atRoom?.params.conversationId ?? null;
  const wanted = atSeq?.params.seq === undefined ? null : Number(atSeq.params.seq);

  // Список разговоров читается один раз при входе, и внутри того эффекта
  // нужно знать, назвал ли адрес разговор. Через ссылку, а не через
  // зависимость: иначе эффект перезапускался бы на каждом переходе
  // и перечитывал список без повода.
  const currentIdRef = useRef(currentId);
  currentIdRef.current = currentId;

  const atRootRef = useRef(location.pathname === "/");
  atRootRef.current = location.pathname === "/";

  // Ключ перехода в зависимостях НАМЕРЕННО «лишний»: повторный переход
  // к ТОЙ ЖЕ реплике обязан подсветить её ещё раз, а по значению он
  // неотличим от предыдущего и был бы съеден молча.
  // biome-ignore lint/correctness/useExhaustiveDependencies: новизна перехода и есть смысл
  const focus = useMemo<Focus | null>(
    () => (currentId && wanted !== null ? { conversationId: currentId, seq: wanted } : null),
    [currentId, wanted, location.key],
  );

  return { currentId, currentIdRef, wanted, focus, atRootRef, navigate };
}
