import assert from "node:assert/strict";
import test from "node:test";
import { parseReferenceQuery } from "../../src/literature/reference-query";

test("quoted bibliography metadata becomes a conservative gateway query", () => {
  assert.deepEqual(
    parseReferenceQuery(
      "Smith, J. and Doe, A. “A Reliable Paper Title.” Journal of Tests, 2024. doi:10.1000/example",
    ),
    {
      identifiers: { doi: "10.1000/example" },
      title: "A Reliable Paper Title.",
      authors: ["Smith", "Doe"],
      year: 2024,
      venue: "Journal of Tests",
      channel: "journal",
    },
  );
});

test("unknown unquoted formats retain bibliographic text without inventing authors", () => {
  const result = parseReferenceQuery(
    "An unfamiliar bibliography layout without stable identifiers",
  );

  assert.equal(
    result.title,
    "An unfamiliar bibliography layout without stable identifiers",
  );
  assert.deepEqual(result.identifiers, {});
  assert.deepEqual(result.authors, []);
  assert.equal(result.channel, "unknown");
});

test("common unquoted author-title-venue entries use all three matching signals", () => {
  const result = parseReferenceQuery(
    "Vaswani, A., et al. Attention Is All You Need. Advances in Neural Information Processing Systems, 2017.",
  );

  assert.equal(result.title, "Attention Is All You Need");
  assert.deepEqual(result.authors, ["Vaswani"]);
  assert.equal(result.year, 2017);
  assert.equal(
    result.venue,
    "Advances in Neural Information Processing Systems",
  );
});

test("IEEE-style references keep real authors, conference venue, and publication year", () => {
  const conference = parseReferenceQuery(
    "Y. Yasuda-Masuoka, J. Jeong, K. Son, S. Lee, S. Park, Y. Lee, J. Youn Kim, J. Lee, M. Cho, S. Lee, S. Hong, H. Hong, Y. Jung, C. Yoon, Y. Ko, K. Jung, T. Myung, J. M. Youn, and G. Jeong, “High performance 4nm finfet platform (4lpe) with novel advanced transistor level dtco for dual-cpp/hp-hd standard cells,” in 2021 IEEE International Electron Devices Meeting (IEDM), 2021, pp. 13.3.1–13.3.4.",
  );
  assert.ok(conference.title);
  assert.equal(conference.title.endsWith(","), false);
  assert.equal(conference.authors.length, 19);
  assert.deepEqual(conference.authors.slice(-2), ["Youn", "Jeong"]);
  assert.equal(
    conference.venue,
    "IEEE International Electron Devices Meeting (IEDM)",
  );
  assert.equal(conference.channel, "conference");

  const doiReference = parseReferenceQuery(
    "R. Zhong, J. Ye, Z. Tang, S. Kai, M. Yuan, J. Hao, and J. Yan, “Preroutgnn for timing prediction,” in Proceedings of the AAAI Conference, 2024. [Online]. Available: https://doi.org/10.1609/aaai.v38i15.29653",
  );
  assert.equal(doiReference.year, 2024);
});

test("joint ACM IEEE proceedings entries preserve the exact title year and ordered authors", () => {
  const result = parseReferenceQuery(
    "T. Bai, Z. Deng, and P. Cao, “Cell library characterization for composite current source models based on gaussian process regression and active learning,” in Proceedings of the 2024 ACM/IEEE International Symposium on Machine Learning for CAD, 2024, pp. 1–7.",
  );

  assert.equal(
    result.title,
    "Cell library characterization for composite current source models based on gaussian process regression and active learning",
  );
  assert.deepEqual(result.authors, ["Bai", "Deng", "Cao"]);
  assert.equal(result.year, 2024);
  assert.equal(result.channel, "conference");
});
