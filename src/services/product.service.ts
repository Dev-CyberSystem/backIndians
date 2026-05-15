import { Product } from '../models';
import { AppError } from '../middlewares/errorHandler';

interface ProductInput {
  name: string;
  description?: string;
  base_price: number;
  category?: string;
  active?: boolean;
}

export async function listProducts(page: number, limit: number, onlyActive = false) {
  const offset = (page - 1) * limit;
  const where = onlyActive ? { active: true } : {};

  const { rows, count } = await Product.findAndCountAll({
    where,
    order: [['name', 'ASC']],
    limit,
    offset,
  });

  return { products: rows, total: count, page, limit };
}

export async function createProduct(input: ProductInput): Promise<Product> {
  return Product.create({
    name: input.name,
    description: input.description || null,
    base_price: input.base_price,
    category: input.category || null,
    active: input.active ?? true,
  });
}

export async function updateProduct(
  id: number,
  input: Partial<ProductInput>
): Promise<Product> {
  const product = await Product.findByPk(id);
  if (!product) throw new AppError('Producto no encontrado', 404);
  await product.update(input);
  return product;
}

export async function deleteProduct(id: number): Promise<void> {
  const product = await Product.findByPk(id);
  if (!product) throw new AppError('Producto no encontrado', 404);
  await product.update({ active: false });
}
