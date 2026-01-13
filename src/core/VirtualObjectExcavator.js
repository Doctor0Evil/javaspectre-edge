import logger from "./Logger.js";

let nextId = 0;

function genId(prefix) {
  nextId += 1;
  return `${prefix}_${nextId.toString(36)}`;
}

export class VirtualObjectExcavator {
  constructor(options = {}) {
    this.maxDepth = typeof options.maxDepth === "number" ? options.maxDepth : 6;
    this.maxArraySample =
      typeof options.maxArraySample === "number"
        ? options.maxArraySample
        : 8;
    this.includeDom = options.includeDom === true;
  }

  /**
   * Excavate virtual-objects from a generic payload.
   * For now, supports JSON trees; DOM and traces are wired later via mode adapters.
   */
  excavate(input) {
    const root = input && Object.prototype.hasOwnProperty.call(input, "value")
      ? input.value
      : input;

    const virtualObjects = [];
    const relationships = [];
    const domSheets = [];

    const rootId = genId("vo");
    this._walkValue(root, rootId, "#", 0, virtualObjects, relationships);

    logger.debug("excavation-complete", {
      virtualObjects: virtualObjects.length,
      relationships: relationships.length
    });

    return {
      virtualObjects,
      relationships,
      domSheets
    };
  }

  _walkValue(value, id, path, depth, vList, relList) {
    if (depth > this.maxDepth) {
      return;
    }

    const t = this._typeOf(value);

    if (t === "object" && value !== null && !Array.isArray(value)) {
      const fields = {};
      for (const [k, v] of Object.entries(value)) {
        fields[k] = this._typeOf(v);
      }
      const vo = {
        id,
        category: "struct",
        path,
        type: "object",
        fields
      };
      vList.push(vo);

      for (const [k, v] of Object.entries(value)) {
        const childId = genId("vo");
        relList.push({
          from: id,
          to: childId,
          kind: "field",
          name: k
        });
        this._walkValue(
          v,
          childId,
          `${path}.${k}`,
          depth + 1,
          vList,
          relList
        );
      }
      return;
    }

    if (Array.isArray(value)) {
      const sampled = value.slice(0, this.maxArraySample);
      const elementTypes = {};
      for (const el of sampled) {
        const et = this._typeOf(el);
        elementTypes[et] = (elementTypes[et] || 0) + 1;
      }
      const vo = {
        id,
        category: "struct",
        path,
        type: "array",
        elementTypes
      };
      vList.push(vo);

      sampled.forEach((el, idx) => {
        const childId = genId("vo");
        relList.push({
          from: id,
          to: childId,
          kind: "element",
          index: idx
        });
        this._walkValue(
          el,
          childId,
          `${path}[${idx}]`,
          depth + 1,
          vList,
          relList
        );
      });
      return;
    }

    const vo = {
      id,
      category: "value",
      path,
      type: t,
      valuePreview: this._preview(value)
    };
    vList.push(vo);
  }

  _typeOf(v) {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    return typeof v;
  }

  _preview(v) {
    if (v === null || typeof v === "number" || typeof v === "boolean") {
      return v;
    }
    if (typeof v === "string") {
      if (v.length <= 64) return v;
      return `${v.slice(0, 61)}...`;
    }
    return null;
  }
}

export default VirtualObjectExcavator;
