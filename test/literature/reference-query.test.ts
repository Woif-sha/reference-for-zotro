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

test("unknown bibliography formats never use the complete citation as a title", () => {
  const result = parseReferenceQuery(
    "Unknown, A. Author data https://example.test/paper, 2024.",
  );

  assert.equal(result.title, null);
  assert.deepEqual(result.identifiers, {});
  assert.deepEqual(result.authors, []);
  assert.equal(result.channel, "unknown");
  assert.equal(parseReferenceQuery("“http://example.test/paper.”").title, null);
});

test("real MinerU 195 IEEE references contain titles only", () => {
  const references = [
    "R. Kanj, R. V. Joshi, and S. R. Nassif. Mixture importance sampling and its application to the analysis of SRAM designs in the presence of rare failure events. In Proc. IEEE/ACM DAC, pages 69–72, 2006.",
    'A. Bansal, R. N. Singh, R. Kanj, S. Mukhopadhyay, J. Lee, E. Acar, A. Singhee, K. Kim, C. Chuang, S. R. Nassif, F. Heng, and K. K. Das. Yield estimation of SRAM circuits using "Virtual SRAM Fab". In Proc. IEEE/ACM ICCAD, pages 631–636, 2009.',
    "J. Wang, S. Yaldiz, X. Li, and L. T. Pileggi. SRAM parametric failure analysis. In Proc. IEEE/ACM DAC, pages 496–501, 2009.",
    "J. Wang, A. Singhee, R. A. Rutenbar, and B. H. Calhoun. Two Fast Methods for Estimating the Minimum Standby Supply Voltage for Large SRAMs. IEEE Trans. on Computer-Aided Design, 29(12):1908–1920, 2010.",
    "C. Amin, C. Kashyap, N. Menezes, K. Killpack, and E. Chiprout. A multi-port current source model for multiple-input switching effects in CMOS library cells. In Proc. IEEE/ACM DAC, pages 247–252, 2006.",
    "P. Li, Z. Feng, and E. Acar. Characterizing Multistage Nonlinear Drivers and Variability for Accurate Timing and Noise Analysis. IEEE Trans. on Very Large Scale Integration (VLSI) Systems, 15(11):1205–1214, 2007.",
    'N. Menezes and C. V. Kashyap and C. S. Amin. A "true" electrical cell model for timing, noise, and power grid verification. In Proc. IEEE/ACM DAC, pages 462-467, 2008.',
    "AMD Corporation. AMD FusionZ Family of APUs: Enabling a Superior, Immersive PC Experience. AMD whitepaper, [Online]. Available: http://sites.amd.com/us/fusion/apu/Pages/fusion.aspx, 2011.",
    "Nvidia Corporation. Bringing High-End Graphics to Handheld Devices. Nvidia whitepaper, 2011.",
    "K. Gulati, J. F. Croix, S. P. Khatri, and R. Shastry. Fast circuit simulation on graphics processing units. In Proc. IEEE/ACM ASPDAC, pages 403-408, 2009.",
    "L. Ren, X. Chen, Y. Wang, C. Zhang, and H. Yang. Sparse LU factorization for parallel circuit simulation on GPU. In Proc. IEEE/ACM DAC, pages 1125-1130, 2012.",
    "L. Pillage, R. Rohrer, and C. Visweswariah. Electronic circuit & system simulation methods. McGraw-Hill, 1995.",
    "Nvidia CUDA programming guide. [Online]. Available: http://www.nvidia.com/object/cuda.html, 2007.",
    "Nvidia Corporation. Fermi compute architecture white paper. [Online]. Available: http://www.nvidia.com/object/fermi\\_architecture.html, 2010.",
  ];

  assert.deepEqual(
    references.map((reference) => parseReferenceQuery(reference).title),
    [
      "Mixture importance sampling and its application to the analysis of SRAM designs in the presence of rare failure events",
      'Yield estimation of SRAM circuits using "Virtual SRAM Fab"',
      "SRAM parametric failure analysis",
      "Two Fast Methods for Estimating the Minimum Standby Supply Voltage for Large SRAMs",
      "A multi-port current source model for multiple-input switching effects in CMOS library cells",
      "Characterizing Multistage Nonlinear Drivers and Variability for Accurate Timing and Noise Analysis",
      'A "true" electrical cell model for timing, noise, and power grid verification',
      "AMD FusionZ Family of APUs: Enabling a Superior, Immersive PC Experience",
      "Bringing High-End Graphics to Handheld Devices",
      "Fast circuit simulation on graphics processing units",
      "Sparse LU factorization for parallel circuit simulation on GPU",
      "Electronic circuit & system simulation methods",
      "Nvidia CUDA programming guide",
      "Fermi compute architecture white paper",
    ],
  );
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

test("Nature-style references remove the complete author and editor regions from titles", () => {
  const references = [
    "Silver, D. et al. Mastering the game of go with deep neural networks and tree search Nature 529, 484–489 (2016).",
    "Jumper, J. M. et al. Highly accurate protein structure prediction with AlphaFold. Nature 596, 583–589 (2021).",
    "OpenAI. GPT-4 Technical Report. Preprint at https://arxiv.org/abs/2303.08774 (2023).",
    "Friedman, J. H. Greedy function approximation: a gradient boosting machine. Ann. Stat 1189–1232 (2001).",
    "Chen, T. & Guestrin, C. Xgboost: A scalable tree boosting system. In Proc. 22nd ACM SIGKDD International Conference on Knowledge Discovery and Data Mining (eds Krishnapuram, B. et al.) 785–794 (ACM Press, 2016)",
    "Ke, G. et al. Lightgbm: A highly efficient gradient boosting decision tree. In Proc. 30th International Conference on Advances in Neural Information Processing Systems (eds Guyon, I. et al.) 3149–3157 (Curran Associates, 2017)",
    "Prokhorenkova, L., Gusev, G., Vorobev, A., Dorogush, A. & Gulin, A. CatBoost: unbiased boosting with categorical features. In Proc. 30th International Conference on Advances in Neural Information Processing Systems (eds Bengio, S. et al.) 6639–6649 (Curran Associates, 2018).",
    "Lowe, D. G. Distinctive image features from scale-invariant keypoints. Int. J. Comput. Vis. 60, 91–110 (2004)",
  ];

  assert.deepEqual(
    references.map((reference) => parseReferenceQuery(reference).title),
    [
      "Mastering the game of go with deep neural networks and tree search",
      "Highly accurate protein structure prediction with AlphaFold",
      "GPT-4 Technical Report",
      "Greedy function approximation: a gradient boosting machine",
      "Xgboost: A scalable tree boosting system",
      "Lightgbm: A highly efficient gradient boosting decision tree",
      "CatBoost: unbiased boosting with categorical features",
      "Distinctive image features from scale-invariant keypoints",
    ],
  );
});

test("Nature-style books, chapters, preprints and missing separators remain title-only", () => {
  const references = [
    "Goodfellow, I., Bengio, Y. & Courville, A. Deep Learning (MIT Press, 2016).",
    "Pearl, J. Causality 2nd edn (Cambridge Univ. Press, 2009).",
    "Jiang, M. et al. Investigating Data Contamination for Pre-training Language Models. Preprint at https://arxiv.org/abs/2401.06059 (2024)",
    "Wilcoxon, F. in Breakthroughs in Statistics: Methodology and Distribution (eds Kotz, S. & Johnson, N. L.) 196–202 (Springer, 1992).",
    "Caruana, R., Munson, A. & Niculescu-Mizil, A. Getting the most out of ensemble selection In Proc. 6th IEEE International Conference on Data Mining (eds Clifton, C. et al.) 828–833 (IEEE, 2006).",
    "Feurer, M. et al. in Automated Machine Learning: Methods, Systems, Challenges (eds Hutter, F. et al.) Ch. 6 (Springer, 2019).",
  ];

  assert.deepEqual(
    references.map((reference) => parseReferenceQuery(reference).title),
    [
      "Deep Learning",
      "Causality 2nd edn",
      "Investigating Data Contamination for Pre-training Language Models",
      "Breakthroughs in Statistics: Methodology and Distribution",
      "Getting the most out of ensemble selection",
      "Automated Machine Learning: Methods, Systems, Challenges",
    ],
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
