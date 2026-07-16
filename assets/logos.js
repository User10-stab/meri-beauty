const createLogo = (label, background, textColor) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="${background}" />
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="28" font-family="Arial, sans-serif" font-weight="700" fill="${textColor}">${label}</text>
    </svg>
  `;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

export const google = createLogo("G", "#EA4335", "#FFFFFF");
export const x = createLogo("X", "#111111", "#FFFFFF");
export const github = createLogo("GH", "#24292F", "#FFFFFF");
export const vimeo = createLogo("V", "#1AB7EA", "#FFFFFF");
export const facebook = createLogo("f", "#1877F2", "#FFFFFF");
