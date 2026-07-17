const { parseLightweightEvent } = require('../light_parser');

describe('parseLightweightEvent', () => {
  test('parses Slovenian utterance locally', () => {
    const input = 'Sestanek z Urbanom jutri ob devetih v Ljubljani';
    const parsed = parseLightweightEvent(input, 'sl');

    expect(parsed).toBeTruthy();
    expect(parsed.language).toBe('sl-SI');
    expect(parsed.title).toBe('Sestanek z Urbanom');
    expect(parsed.location).toBe('Ljubljani');
    expect(parsed.intent).toBe('create_event');
  });

  test('parses English utterance locally', () => {
    const input = 'Meeting with Ana tomorrow at 9am in London';
    const parsed = parseLightweightEvent(input, 'en-US');

    expect(parsed).toBeTruthy();
    expect(parsed.language).toBe('en-US');
    expect(parsed.title).toBe('Meeting with Ana');
    expect(parsed.location).toBe('London');
    expect(parsed.intent).toBe('create_event');
  });

  test('supports British English language tag', () => {
    const input = 'Meeting with Ana tomorrow at 9am in London';
    const parsed = parseLightweightEvent(input, 'en-GB');

    expect(parsed).toBeTruthy();
    expect(parsed.language).toBe('en-GB');
  });

  test('parses English meridiem indicators', () => {
    const input = 'Meeting with Ana tomorrow at 9pm in London';
    const parsed = parseLightweightEvent(input, 'en-US');

    expect(parsed).toBeTruthy();
    expect(new Date(parsed.start).getHours()).toBe(21);
  });
});
