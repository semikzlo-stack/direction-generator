// Brand loading: config + fonts (browser).

export async function loadBrand(baseUrl) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const res = await fetch(base + 'config.json');
  if (!res.ok) throw new Error(`Brand config not found: ${base}config.json`);
  const brand = await res.json();
  brand.baseUrl = base;
  await loadFonts(brand);
  return brand;
}

export async function loadFonts(brand) {
  const faces = brand.fonts.map(f => new FontFace(f.family, `url(${brand.baseUrl}${f.file})`, {
    weight: String(f.weight), style: f.style,
  }));
  await Promise.all(faces.map(face => face.load().then(ff => document.fonts.add(ff))));
  // Canvas text needs the faces resolved before the first measure.
  await document.fonts.ready;
}
