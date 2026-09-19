import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSuggestions, confirmationKey } from '../intake.js';

test('conflicting observations stay separate and retain their photo origins', () => {
  const images = ['SN-O0', 'SN-00', 'SN-O0'].map((value, i) => ({ id: String(i), result: { observations: [{ field: 'serialNumber', value, status: 'observed' }] } }));
  const suggestions = collectSuggestions(images).serialNumber;
  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions[0].imageIds, ['0', '2']);
});
test('changing any identifier invalidates confirmation; empty form strings equal omitted fields', () => {
  const unit = { serialNumber: 'O0-I1', assetTag: '' };
  const key = confirmationKey(unit, { partNumber: '' });
  assert.equal(key, confirmationKey(unit, {}));
  assert.notEqual(key, confirmationKey({ ...unit, serialNumber: '00-I1' }, {}));
  assert.notEqual(key, confirmationKey(unit, { partNumber: 'PART' }));
});

test('brand capitalization across photos is one suggestion, while serial characters remain distinct', () => {
  const images = ['HP', 'hp'].map((value, i) => ({ id: String(i), result: { observations: [
    { field: 'brandName', value, status: 'observed' },
    { field: 'serialNumber', value: i ? 'SN-I0' : 'SN-10', status: 'observed' },
  ] } }));
  const suggestions = collectSuggestions(images);
  assert.equal(suggestions.brandName.length, 1); assert.deepEqual(suggestions.brandName[0].imageIds, ['0', '1']);
  assert.equal(suggestions.serialNumber.length, 2);
});
