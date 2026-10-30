import PigScene from './pig-scene';

export default function Loading() {
  return (
    <main className="app-loading" aria-busy="true">
      <PigScene mode="loading" />
      <p role="status">화면을 불러오고 있습니다.</p>
    </main>
  );
}
