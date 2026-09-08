import { useEffect, useState } from "react";
import { api, type Me } from "../data/api.js";
import { AuthScreen } from "../screens/AuthScreen.js";
import { ChatScreen } from "./ChatScreen.js";

type State =
  | { status: "loading" }
  /** notice — то, что человек обязан узнать при возврате на экран входа. */
  | { status: "anon"; notice?: string }
  | { status: "entered"; me: Me };

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });

  // Кто пришёл — спрашиваем у сервера, а не у localStorage: печенька
  // HttpOnly, и это единственный честный источник ответа.
  useEffect(() => {
    api
      .me()
      .then((me) => setState({ status: "entered", me }))
      .catch(() => setState({ status: "anon" }));
  }, []);

  if (state.status === "loading") return null;

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
