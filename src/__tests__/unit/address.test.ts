import { streetWithUnit, optionalUnit } from '../../utils/address';

/*
 * Piso y departamento son opcionales en el checkout de la tienda. La línea de
 * calle que va a la etiqueta de envío y al comprobante tiene que quedar igual
 * que siempre cuando no se informan, y sumarlos cuando sí.
 */

describe('streetWithUnit', () => {
  it('sin piso ni departamento deja la calle tal cual', () => {
    expect(streetWithUnit({ street: 'Av. Mate de Luna 1234' })).toBe('Av. Mate de Luna 1234');
  });

  it('suma piso y departamento', () => {
    expect(streetWithUnit({ street: 'Av. Mate de Luna 1234', floor: '4', apartment: 'B' }))
      .toBe('Av. Mate de Luna 1234, Piso 4, Depto B');
  });

  it('acepta solo uno de los dos', () => {
    expect(streetWithUnit({ street: 'San Martín 50', floor: 'PB' })).toBe('San Martín 50, Piso PB');
    expect(streetWithUnit({ street: 'San Martín 50', apartment: '12' })).toBe('San Martín 50, Depto 12');
  });

  it('ignora valores vacíos o con solo espacios', () => {
    expect(streetWithUnit({ street: 'San Martín 50', floor: '  ', apartment: '' })).toBe('San Martín 50');
  });

  it('tolera una dirección ausente', () => {
    expect(streetWithUnit(null)).toBe('');
    expect(streetWithUnit(undefined)).toBe('');
  });
});

describe('optionalUnit', () => {
  it('recorta y devuelve undefined si quedó vacío o no es texto', () => {
    expect(optionalUnit('  4 ')).toBe('4');
    expect(optionalUnit('   ')).toBeUndefined();
    expect(optionalUnit(undefined)).toBeUndefined();
    expect(optionalUnit(null)).toBeUndefined();
    expect(optionalUnit(4)).toBeUndefined();
  });
});
