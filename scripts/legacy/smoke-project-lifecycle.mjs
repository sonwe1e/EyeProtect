import { call, evaluate, waitFor, waitForTarget } from './lib/cdp.mjs';

const port = Number(process.argv[2] ?? 9333);
const endpoint = `http://127.0.0.1:${port}`;
const pet = await waitForTarget(endpoint, '#pet');
await waitFor(pet, `Boolean(window.eyeProtect?.createProject && window.eyeProtect?.openWorkbench)`);
await evaluate(pet, `(async () => {
  for (const project of await window.eyeProtect.getProjects()) {
    if (project.name === 'SMOKE_LIFECYCLE') await window.eyeProtect.deleteProject(project.id);
  }
  await window.eyeProtect.createProject({ name: 'SMOKE_LIFECYCLE', color: '#2e6f61' });
  await window.eyeProtect.openWorkbench('today');
})()`);

const workbench = await waitForTarget(endpoint, '#workbench');
await waitFor(workbench, `Boolean(document.querySelector('.workbench-v2'))`);
await evaluate(workbench, `([...document.querySelectorAll('.app-nav-item')].find((item) => item.textContent?.includes('项目')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.projects-overview'))`);
await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((item) => item.textContent?.includes('SMOKE_LIFECYCLE')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);

// Clicking the selected project again must keep its workspace open.
await evaluate(workbench, `([...document.querySelectorAll('.project-item')].find((item) => item.textContent?.includes('SMOKE_LIFECYCLE')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.project-page'))`);

const chooseProjectAction = async (label) => {
  await evaluate(workbench, `(() => {
    const item = [...document.querySelectorAll('.project-item')].find((entry) => entry.textContent?.includes('SMOKE_LIFECYCLE'));
    item?.querySelector('.project-item-menu-trigger')?.click();
  })()`);
  await waitFor(workbench, `Boolean(document.querySelector('.project-item-menu'))`);
  await evaluate(workbench, `([...document.querySelectorAll('.project-item-menu button')].find((button) => button.textContent?.includes(${JSON.stringify(label)})))?.click()`);
};

await chooseProjectAction('暂存');
await waitFor(workbench, `(async () => (await window.eyeProtect.getProjects()).some((project) => project.name === 'SMOKE_LIFECYCLE' && project.status === 'onHold'))()`);
await chooseProjectAction('恢复进行');
await waitFor(workbench, `(async () => (await window.eyeProtect.getProjects()).some((project) => project.name === 'SMOKE_LIFECYCLE' && project.status === 'active'))()`);

await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'n', code: 'KeyN' });
await call(workbench, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'n', code: 'KeyN' });
await waitFor(workbench, `document.activeElement?.matches('[data-quick-add="true"]') && Boolean(document.querySelector('.project-page'))`);

await evaluate(workbench, `document.querySelector('.command-palette-trigger')?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.command-palette-search input'))`);
await evaluate(workbench, `(() => {
  const input = document.querySelector('.command-palette-search input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, '搜索任务或项目');
  input?.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await waitFor(workbench, `[...document.querySelectorAll('.command-palette-list button')].some((button) => button.textContent?.includes('搜索任务或项目'))`);
await evaluate(workbench, `([...document.querySelectorAll('.command-palette-list button')].find((button) => button.textContent?.includes('搜索任务或项目')))?.click()`);
await waitFor(workbench, `Boolean(document.querySelector('.workspace-search input'))`);
await evaluate(workbench, `(() => {
  const input = document.querySelector('.workspace-search input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, 'SMOKE_LIFECYCLE');
  input?.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await waitFor(workbench, `[...document.querySelectorAll('.project-search-results button')].some((button) => button.textContent?.includes('SMOKE_LIFECYCLE'))`);

console.log('Project lifecycle, repeated selection, contextual N, and project search passed.');
