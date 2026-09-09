import { useEffect, useState } from "react";
import { useMatch, useNavigate } from "react-router";
import { api, type Me } from "../data/api.js";
import { AuthScreen } from "../screens/AuthScreen.js";
import { JoinScreen } from "../screens/JoinScreen.js";
import { ChatScreen } from "./ChatScreen.js";

type State =
  | { status: "loading" }
  /** notice — то, что человек обязан узнать при возврате на экран входа. */
  | { status: "anon"; notice?: string }
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
  const navigate = useNavigate();

  // Кто пришёл — спрашиваем у сервера, а не у localStorage: печенька
  // HttpOnly, и это единственный честный источник ответа.
  useEffect(() => {
    api
      .me()
      .then((me) => setState({ status: "entered", me }))
      .catch(() => setState({ status: "anon" }));
  }, []);

  if (state.status === "loading") return null;

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
        <AuthScreen onEntered={(me) => setState({ status: "entered", me })} />
      </>
    );
  }

  return (
    <ChatScreen
      me={state.me}
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
