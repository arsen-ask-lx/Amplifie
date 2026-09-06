import { useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen.js";
import { api, type Me } from "./api.js";
import { HomeScreen } from "./HomeScreen.js";

type State = { status: "loading" } | { status: "anon" } | { status: "entered"; me: Me };

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
    return <AuthScreen onEntered={(me) => setState({ status: "entered", me })} />;
  }

  return (
    <HomeScreen
      me={state.me}
      onLeave={async () => {
        await api.logout().catch(() => {});
        setState({ status: "anon" });
      }}
    />
  );
}
