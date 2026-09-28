export function selectPageTab(tabs, origin, preferredTabId) {
  const matchingTabs = tabs.filter(tab => tab.id !== undefined && tab.url?.startsWith(`${origin}/`));
  if (preferredTabId !== undefined) return matchingTabs.find(tab => tab.id === preferredTabId) || null;
  return matchingTabs.length === 1 ? matchingTabs[0] : null;
}
