import type { CatalogVariant } from '../features/catalog/model';
import type { CatalogProduct } from '../features/catalog/editorModel';
export type PreviewVariant = CatalogVariant & { quantity: number; category_id: number; is_active: boolean };
type PreviewCategory = { id: number; name: string; currency: string; is_active: boolean };
/** Design-only simulator. Real contract tests use isolated Django/PostgreSQL, not this module. */
export function createPreviewCatalog(variants: PreviewVariant[], categories: PreviewCategory[]) {
  let nextId = 100;
  const products = new Map<number, Omit<CatalogProduct, 'variants'>>(variants.map(v => [v.product, { id: v.product, name: v.product_name, category: v.category_id, is_active: true, image: v.image || null, gallery_images: [] }]));
  const detail = (id: number) => {
    const product = products.get(id); if (!product) throw Error('Mahsulot topilmadi.');
    return { ...product, variants: variants.filter(v => v.product === id).map(v => ({ ...v })) };
  };
  const categoryFor = (id: number) => { const c = categories.find(c => c.id === id && c.is_active); if (!c) throw Error('Faol kategoriyani tanlang.'); return c; };
  const addVariant = (product: ReturnType<typeof detail>, body: any) => {
    if (!body.name?.trim()) throw Error('Variant nomi kerak.');
    if (variants.some(v => v.product === product.id && v.name === body.name || body.barcode && v.barcode === body.barcode)) throw Error('Variant nomi yoki shtrix-kod band.');
    const c = categoryFor(product.category);
    const created: PreviewVariant = { ...body, id: nextId++, product: product.id, product_name: product.name, category_id: c.id, category_name: c.name, currency: c.currency as 'UZS' | 'USD', unit: body.unit || 'dona', stock_quantity: 0, quantity: 0, image: null, is_active: true, sku: 'DEMO-' + nextId };
    variants.push(created); return { ...created };
  };
  return (url: URL, method: string, body: any): { handled: boolean; data?: any } => {
    const path = url.pathname, productMatch = path.match(/^\/catalog\/products\/(\d+)\/(archive\/|unarchive\/|variants\/)?$/), variantMatch = path.match(/^\/catalog\/variants\/(\d+)\/(archive\/|unarchive\/)?$/);
    if (method === 'GET' && path === '/catalog/variants/') {
      const search = (url.searchParams.get('search') || '').toLowerCase(), ids = url.searchParams.get('ids')?.split(',').map(Number);
      const rows = variants.filter(v => {
        const active = v.is_active && products.get(v.product)?.is_active;
        return (url.searchParams.get('archived') === 'true' ? !active : active) && (!ids || ids.includes(v.id)) && (!url.searchParams.has('category') || v.category_id === Number(url.searchParams.get('category'))) && (!url.searchParams.get('barcode') || v.barcode === url.searchParams.get('barcode')) && [v.product_name, v.name, v.sku, v.code, v.barcode].some(text => text?.toLowerCase().includes(search));
      });
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1), size = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size')) || 50));
      return { handled: true, data: { count: rows.length, results: rows.slice((page - 1) * size, page * size).map(v => ({ ...v })), next: page * size < rows.length ? '?page=' + (page + 1) : null } };
    }
    if (path === '/catalog/products/' && method === 'POST') {
      if (!body.name?.trim()) throw Error('Mahsulot nomi kerak.');
      const c = categoryFor(body.category_id), id = nextId++;
      products.set(id, { id, name: body.name, category: c.id, image: null, gallery_images: [], is_active: true });
      try { addVariant(detail(id), { ...body, name: body.variant_name || 'Standart' }); } catch (error) { products.delete(id); throw error; }
      return { handled: true, data: detail(id) };
    }
    if (productMatch) {
      const id = Number(productMatch[1]), operation = productMatch[2], product = products.get(id);
      if (!product) throw Error('Mahsulot topilmadi.');
      if (method === 'GET' && !operation) return { handled: true, data: detail(id) };
      if (method === 'POST' && operation === 'variants/') return { handled: true, data: addVariant(detail(id), body) };
      if (method === 'PATCH' && !operation) {
        const c = categoryFor(body.category_id || product.category);
        if (variants.some(v => v.product === id && Number(v.stock_quantity) > 0 && v.currency !== c.currency)) throw Error('Qoldig‘i bor mahsulot valyutasi o‘zgarmaydi.');
        Object.assign(product, { name: body.name || product.name, category: c.id });
        for (const variant of variants.filter(v => v.product === id)) Object.assign(variant, { product_name: product.name, category_id: c.id, category_name: c.name, currency: c.currency });
        return { handled: true, data: detail(id) };
      }
      if (method === 'POST' && ['archive/', 'unarchive/'].includes(operation || '')) {
        product.is_active = operation === 'unarchive/';
        for (const variant of variants.filter(v => v.product === id)) variant.is_active = product.is_active;
        return { handled: true, data: detail(id) };
      }
      if (method === 'DELETE' && !operation) {
        if (variants.some(v => v.product === id && Number(v.stock_quantity) > 0)) { product.is_active = false; for (const v of variants.filter(v => v.product === id)) v.is_active = false; }
        else { products.delete(id); for (let i = variants.length - 1; i >= 0; i--) if (variants[i].product === id) variants.splice(i, 1); }
        return { handled: true, data: null };
      }
    }
    if (variantMatch) {
      const id = Number(variantMatch[1]), operation = variantMatch[2], variant = variants.find(v => v.id === id);
      if (!variant) throw Error('Variant topilmadi.');
      if (method === 'PATCH' && !operation) {
        if (variants.some(v => v.id !== id && (v.product === variant.product && v.name === body.name || body.barcode && v.barcode === body.barcode))) throw Error('Variant nomi yoki shtrix-kod band.');
        Object.assign(variant, body); return { handled: true, data: { ...variant } };
      }
      if (method === 'POST' && ['archive/', 'unarchive/'].includes(operation || '')) {
        variant.is_active = operation === 'unarchive/'; if (variant.is_active) products.get(variant.product)!.is_active = true;
        return { handled: true, data: { ...variant } };
      }
      if (method === 'DELETE' && !operation) {
        if (!variants.some(v => v.product === variant.product && v.id !== id && v.is_active)) {
          const product = products.get(variant.product)!;
          if (variants.some(v => v.product === product.id && Number(v.stock_quantity) > 0)) { product.is_active = false; for (const v of variants.filter(v => v.product === product.id)) v.is_active = false; }
          else { products.delete(product.id); for (let i = variants.length - 1; i >= 0; i--) if (variants[i].product === product.id) variants.splice(i, 1); }
        } else if (Number(variant.stock_quantity) > 0) variant.is_active = false; else variants.splice(variants.indexOf(variant), 1);
        return { handled: true, data: null };
      }
    }
    return { handled: false };
  };
}
