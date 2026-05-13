import { Link } from "react-router-dom";

const FONT = "'JetBrains Mono', monospace";
const ACCENT = "#96ea28";
const BG = "#080808";

export default function About() {
  return (
    <div style={{
      minHeight: "100vh", background: BG, fontFamily: FONT,
      color: "#fff", padding: "60px 24px", boxSizing: "border-box",
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>

        <div style={{ fontSize: 11, color: ACCENT, marginBottom: 16 }}>
          root@yakutia:~$ cat README.md
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, lineHeight: 1.2 }}>
          карта разработчиков из Якутии
        </h1>

        <div style={{ width: 32, height: 1, background: ACCENT, opacity: 0.4, marginBottom: 32 }} />

        <p style={{ fontSize: 13, color: "#888", lineHeight: 1.8, marginBottom: 24 }}>
          Интерактивная карта разработчиков из Якутии и якутского IT-сообщества по всему миру.
          Отмечай себя, находи земляков по городу или специализации, следи за ростом комьюнити в реальном времени.
        </p>

        <Section title="как это работает">
          <Item>Нажми «→ отметиться на карте» и заполни форму</Item>
          <Item>Твоя точка появится на карте мгновенно у всех онлайн</Item>
          <Item>Кликай на точки чтобы смотреть профили</Item>
          <Item>Фильтруй по специализации через теги снизу</Item>
          <Item>Ищи по имени или городу через поиск справа</Item>
          <Item>Переключись в режим глобуса — кнопка «○ globe» в левом углу</Item>
        </Section>

        <Section title="стек">
          <Item>React + Vite</Item>
          <Item>D3.js + TopoJSON — карта и визуализация</Item>
          <Item>Versor — вращение 3D глобуса через кватернионы</Item>
          <Item>Supabase — база данных и realtime</Item>
          <Item>Nominatim — геокодинг городов</Item>
        </Section>

        <Section title="ссылки">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <ExtLink href="https://github.com/yokithaiii/yktcoders-worldmap">GitHub</ExtLink>
          </div>
        </Section>

        <Link to="/" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          marginTop: 40, fontSize: 12, color: ACCENT,
          textDecoration: "none", opacity: 0.8,
        }}>
          ← вернуться на карту
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontSize: 11, color: ACCENT, marginBottom: 12 }}>→ {title}</div>
      {children}
    </div>
  );
}

function Item({ children }) {
  return (
    <div style={{ fontSize: 12, color: "#666", marginBottom: 6, paddingLeft: 12 }}>
      · {children}
    </div>
  );
}

function ExtLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      fontSize: 12, color: "#666", textDecoration: "none",
      paddingLeft: 12,
    }}
      onMouseEnter={(e) => e.currentTarget.style.color = ACCENT}
      onMouseLeave={(e) => e.currentTarget.style.color = "#666"}
    >
      · {children} ↗
    </a>
  );
}
