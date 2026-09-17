import { useEffect, useState } from "react";
import { Navigate, useMatch, useNavigate } from "react-router";
import { api, type Me } from "../data/api.js";
import { AuthScreen } from "../screens/AuthScreen.js";
import { JoinScreen } from "../screens/JoinScreen.js";
import { screenTroubleOf } from "../shared/trouble.js";
import { Button } from "../shared/ui/button.js";
import { ChatScreen } from "./ChatScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { Setup } from "./Setup.js";

type State =
  | { status: "loading" }
  /**
   * Сервер не отвечает дольше, чем терпит загрузка (task-096). Это не «не
   * вошёл»: сеанс, скорее всего, жив, и экран входа заставил бы человека
   * вводить пароль ради сбоя, который пройдёт сам.
   */
  | { status: "unreachable" }
  /** notice — то, что человек обязан узнать при возврате на экран входа. */
  | { status: "anon"; notice?: string }
  /**
   * Компанию только что завели — идёт мастер первого запуска (task-023).
   * Отдельное состояние, а не признак у `entered`: продукт под мастером
   * не отрисовывается вовсе, и путать эти два экрана нельзя.
   */
  | { status: "setup"; me: Me }
  | { status: "entered"; me: Me };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  /**
   * Пришли по приглашению.
   *
   * ⚠️ ОТДЕЛЬНЫЙ АДРЕС И ОТДЕЛЬНЫЙ ЭКРАН, А НЕ ГАЛОЧКА НА РЕГИСТРАЦИИ:
   * два потока входа в одном месте — это ровно тот класс уязвимости,
   * ради которого написано Р-009.
   */
  const invited = useMatch("/join/:token");
  const settings = useMatch("/settings/*");
  const legacyAgents = useMatch("/agents");
  const navigate = useNavigate();

  /**
   * Начать с чистого адреса.
   *
   * ⚠️ АДРЕС ПРОШЛОГО ЧЕЛОВЕКА НЕ ПЕРЕЖИВАЕТ СМЕНУ ЧЕЛОВЕКА. Вышли, стоя
   * в канале, вошли другим — и приложение открывало ТОТ ЖЕ `/c/<канал>`,
   * который теперь чужой. Сервер отвечал 404 (и правильно: чужой канал
   * неотличим от несуществующего), а человек видел «Не удалось загрузить
   * сообщения» на первом же экране новой компании. Найдено сквозным
   * прогоном руками.
   *
   * `replace`, а не переход: «назад» не должно возвращать на чужой адрес.
   */
  const fromScratch = () => navigate("/", { replace: true });

  // Кто пришёл — спрашиваем у сервера, а не у localStorage: печенька
  // HttpOnly, и это единственный честный источник ответа.
  const [asked, setAsked] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: счётчик попытки — сам повод спросить заново («Повторить»)
  useEffect(() => {
    const stop = new AbortController();
    api
      .me(stop.signal)
      .then((me) => setState({ status: "entered", me }))
      .catch((error: unknown) => {
        if (stop.signal.aborted) return;
        // Недоступен — не повод выгонять на вход; всё остальное (нет сессии,
        // 429 за общим адресом) ведёт на вход, как и раньше.
        setState({
          status: screenTroubleOf(error) === "сервер-недоступен" ? "unreachable" : "anon",
        });
      });
    return () => stop.abort();
  }, [asked]);

  if (state.status === "loading") return null;

  if (state.status === "unreachable") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-bg text-ink">
        <p className="text-body">Не удаётся связаться с сервером.</p>
        <Button
          variant="outline"
          onClick={() => {
            setState({ status: "loading" });
            setAsked((n) => n + 1);
          }}
        >
          Повторить
        </Button>
      </div>
    );
  }

  const token = invited?.params.token;
  if (token && state.status !== "entered") {
    return (
      <JoinScreen
        token={token}
        onEntered={(me) => {
          // ⚠️ ТОКЕН УБИРАЕТСЯ ИЗ АДРЕСА СРАЗУ. Он уже погашен, но остался
          // бы в истории браузера и в заголовке вкладки — а это то самое,
          // чем входят. `replace` вместо перехода: «назад» не должен
          // возвращать на страницу с токеном.
          navigate("/", { replace: true });
          setState({ status: "entered", me });
        }}
      />
    );
  }

  if (state.status === "anon") {
    return (
      <>
        {state.notice ? (
          <div className="mb-3 rounded border border-danger/40 bg-panel px-3 py-2 text-aside text-danger">
            {state.notice}
          </div>
        ) : null}
        <AuthScreen
          onEntered={(me) => {
            fromScratch();
            setState({ status: "entered", me });
          }}
          onInstalled={(me) => {
            fromScratch();
            setState({ status: "setup", me });
          }}
        />
      </>
    );
  }

  if (state.status === "setup") {
    return <Setup onDone={() => setState({ status: "entered", me: state.me })} />;
  }

  if (legacyAgents) return <Navigate to="/settings/agents" replace />;
  if (settings) return <SettingsScreen me={state.me} />;

  return (
    <ChatScreen
      me={state.me}
      // Сессия кончилась, пока вкладка была открыта: истёк срок или вышли
      // в другой вкладке (task-093). Живые обновления без неё не приходят,
      // и молчащий экран хуже честного входа.
      onSessionEnded={() =>
        setState({ status: "anon", notice: "Сеанс закончился — войдите снова." })
      }
      onLeave={async () => {
        // Выйти локально обязаны в любом случае: человек нажал «выйти», и
        // держать его в приложении из-за сетевой ошибки — худшее из решений.
        // Но и глушить молча нельзя: если запрос не дошёл, серверная сессия
        // ещё жива и погаснет только по сроку. Говорим об этом вслух.
        const reachedServer = await api.logout().then(
          () => true,
          () => false,
        );
        // Поле не подставляем как undefined: при exactOptionalPropertyTypes
        // «нет поля» и «поле равно undefined» — разные вещи, и это правильно.
        setState(
          reachedServer
            ? { status: "anon" }
            : {
                status: "anon",
                notice:
                  "Мы вышли на этом устройстве, но сервер не ответил: сеанс мог остаться открытым.",
              },
        );
      }}
    />
  );
}
