import { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.js";
import { api, type Me } from "./api.js";
import { ChatScreen } from "./ChatScreen.js";
import { JoinScreen } from "./JoinScreen.js";

type State =
  | { status: "loading" }
  /** notice — то, что человек обязан узнать при возврате на экран входа. */
  | { status: "anon"; notice?: string }
  | { status: "entered"; me: Me };

/**
 * Токен приглашения из адреса. Читается ОДИН раз при запуске и тут же
 * убирается из адресной строки: ссылка не должна остаться в истории
 * браузера и уехать в закладки или в чужой скриншот.
 */
function takeInviteFromUrl(): string | null {
  const found = new URLSearchParams(window.location.search).get("invite");
  if (!found) return null;
  window.history.replaceState(null, "", window.location.pathname);
  return found;
}

export function App() {
  const [state, setState] = useState<State>({ status: "loading" });
  // Токен снимается со СТРАНИЦЫ один раз, но живёт в состоянии до тех пор,
  // пока не применён. Не гасить его после успешного входа — значит сразу
  // после входа показать «приглашение не применилось» тому, кто только что
  // вошёл именно по нему. Так и было, поймано живым прогоном.
  const [invite, setInvite] = useState(takeInviteFromUrl);

  // Кто пришёл — спрашиваем у сервера, а не у localStorage: печенька
  // HttpOnly, и это единственный честный источник ответа.
  useEffect(() => {
    api
      .me()
      .then((me) => setState({ status: "entered", me }))
      .catch(() => setState({ status: "anon" }));
  }, []);

  if (state.status === "loading") return null;

  // Пришёл по приглашению, но уже вошёл под другим именем. Молча
  // потерять приглашение нельзя: человек решит, что ссылка не работает,
  // и попросит новую — а старая при этом останется живой.
  if (state.status === "entered" && invite) {
    return (
      <div className="screen">
        <div className="card">
          <h1>Приглашение не применилось</h1>
          <p className="sub">
            Вы уже вошли как {state.me.participant.displayName} в пространстве{" "}
            {state.me.workspace.name}. Приглашение заводит отдельный вход — выйдите и откройте
            ссылку снова. Она не потрачена.
          </p>
          <button
            type="button"
            onClick={() => {
              // Токен вычищен из адреса при чтении (чтобы не осел в истории),
              // поэтому просто перезагрузить страницу мало — приглашение
              // потерялось бы. Возвращаем его в адрес явно.
              void api
                .logout()
                .finally(() => window.location.replace(`/?invite=${encodeURIComponent(invite)}`));
            }}
          >
            Выйти и принять приглашение
          </button>
        </div>
      </div>
    );
  }

  // Пришёл по приглашению и ещё не вошёл — ему нужен другой экран.
  if (state.status === "anon" && invite) {
    return (
      <JoinScreen
        token={invite}
        onEntered={(me) => {
          setInvite(null);
          setState({ status: "entered", me });
        }}
      />
    );
  }

  if (state.status === "anon") {
    return (
      <>
        {state.notice ? <div className="err-top">{state.notice}</div> : null}
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
