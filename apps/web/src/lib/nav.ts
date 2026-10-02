export const screenHref = (module: string, screen: string, id?: unknown) =>
  `/m/${module}/${screen}${id !== undefined && id !== null && id !== '' ? `/${encodeURIComponent(String(id))}` : ''}`;
