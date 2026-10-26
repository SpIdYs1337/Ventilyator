import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@ventilyator/ui';
export class SectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="panel info-panel" role="alert"><h1>Не удалось открыть раздел</h1><p>Соединение могло прерваться или интерфейс был обновлён. Обновите страницу и повторите действие.</p><div className="inline-actions"><Button onClick={() => window.location.reload()}>Обновить страницу</Button><Button asChild variant="outline"><Link to="/projects">К проектам</Link></Button></div></section>;
  }
}
