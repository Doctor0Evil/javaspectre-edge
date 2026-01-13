import logger from "../core/Logger.js";

export class MultiPassEngine {
  constructor(options = {}) {
    this.maxDeepRegions =
      typeof options.maxDeepRegions === "number" ? options.maxDeepRegions : 16;
  }

  /**
   * Run a two-pass excavation:
   *  - shallowFn: (input) -> excavationResult with lightweight metrics
   *  - deepFn: (input, region) -> excavationResult focused on a region
   *  - regionSelector: (shallowResult) -> array of "regions of interest"
   */
  run({ input, shallowFn, deepFn, regionSelector }) {
    const shallowResult = shallowFn(input);
    const regions = regionSelector
      ? regionSelector(shallowResult)
      : [];

    const selectedRegions = regions.slice(0, this.maxDeepRegions);
    const deepResults = [];

    logger.info("multipass-shallow-complete", {
      regionsFound: regions.length,
      regionsUsed: selectedRegions.length
    });

    for (const region of selectedRegions) {
      const deep = deepFn(input, region);
      deepResults.push({ region, deep });
    }

    return { shallowResult, deepResults };
  }
}

export default MultiPassEngine;
