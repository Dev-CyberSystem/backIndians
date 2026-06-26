import { StoreWishlist } from '../models';

export async function getWishlistIds(customerId: number): Promise<number[]> {
  const items = await StoreWishlist.findAll({
    where: { customer_id: customerId },
    attributes: ['catalog_product_id'],
  });
  return items.map((i) => i.catalog_product_id);
}

export async function toggleWishlistItem(customerId: number, productId: number): Promise<number[]> {
  const existing = await StoreWishlist.findOne({
    where: { customer_id: customerId, catalog_product_id: productId },
  });
  if (existing) {
    await existing.destroy();
  } else {
    await StoreWishlist.create({ customer_id: customerId, catalog_product_id: productId });
  }
  return getWishlistIds(customerId);
}

// Fusiona favoritos anónimos (localStorage) con los del servidor al iniciar sesión.
export async function mergeWishlistItems(customerId: number, productIds: number[]): Promise<number[]> {
  if (productIds.length > 0) {
    await StoreWishlist.bulkCreate(
      productIds.map((id) => ({ customer_id: customerId, catalog_product_id: id })),
      { ignoreDuplicates: true }
    );
  }
  return getWishlistIds(customerId);
}
