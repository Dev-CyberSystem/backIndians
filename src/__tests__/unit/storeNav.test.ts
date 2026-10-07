import { parseTagFilter, buildNavAvailability, SELECTION_TAG, MAX_TAG_FILTERS } from '../../utils/storeNav';

/*
 * Menú de la tienda (pedido 04 del brief 06.10.2026): "Tops y remeras" filtra por
 * dos tags a la vez, y los submenús de Fútbol (clubes, Selecciones) y Pádel
 * (Mujer "cuando haya stock") salen de lo que realmente hay publicado.
 */

describe('parseTagFilter', () => {
  it('un solo tag queda igual', () => {
    expect(parseTagFilter('Remera')).toEqual(['Remera']);
  });

  it('separa por coma, recorta y descarta vacíos y duplicados', () => {
    expect(parseTagFilter(' Top , Remera,,Top ')).toEqual(['Top', 'Remera']);
  });

  it('tolera ausencia de valor', () => {
    expect(parseTagFilter(undefined)).toEqual([]);
    expect(parseTagFilter('')).toEqual([]);
    expect(parseTagFilter(' , ')).toEqual([]);
  });

  it('respeta el tope de valores', () => {
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`).join(',');
    expect(parseTagFilter(many)).toHaveLength(MAX_TAG_FILTERS);
  });
});

describe('buildNavAvailability', () => {
  const names = new Map([[1, 'River'], [2, 'Boca'], [3, 'Argentina']]);

  it('agrupa géneros y clubes por categoría, ordenados por nombre', () => {
    const out = buildNavAvailability([
      { category: 'Fútbol', gender: 'masculino', client_id: 2, tags: ['Camiseta'] },
      { category: 'Fútbol', gender: 'masculino', client_id: 1, tags: '["Camiseta"]' },
      { category: 'Fútbol', gender: 'femenino', client_id: 1, tags: null },
      { category: 'Pádel', gender: 'masculino', client_id: 1, tags: [] },
    ], names);

    expect(out.category_genders['Fútbol']).toEqual(['femenino', 'masculino']);
    expect(out.category_genders['Pádel']).toEqual(['masculino']); // sin Mujer → no hay stock femenino
    expect(out.category_clients['Fútbol']).toEqual([{ id: 2, name: 'Boca' }, { id: 1, name: 'River' }]);
    expect(out.category_tags['Fútbol']).toEqual(['Camiseta']);
  });

  it('las camisetas de selección no cuentan como club pero sí como tag', () => {
    const out = buildNavAvailability([
      { category: 'Fútbol', gender: null, client_id: 3, tags: [SELECTION_TAG, 'Camiseta'] },
      { category: 'Fútbol', gender: null, client_id: 1, tags: ['Camiseta'] },
    ], names);

    expect(out.category_clients['Fútbol']).toEqual([{ id: 1, name: 'River' }]);
    expect(out.category_tags['Fútbol']).toContain(SELECTION_TAG);
  });

  it('ignora productos sin categoría, clientes desconocidos y tags JSON inválidos', () => {
    const out = buildNavAvailability([
      { category: null, gender: 'masculino', client_id: 1, tags: ['X'] },
      { category: '  ', gender: 'masculino', client_id: 1, tags: ['X'] },
      { category: 'Running', gender: null, client_id: 99, tags: '{no es json' },
    ], names);

    expect(out.category_genders).toEqual({});
    expect(out.category_clients).toEqual({});
    expect(out.category_tags).toEqual({});
  });
});
