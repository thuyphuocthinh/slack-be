import { StrictJsonValue } from '@slack/common';
import { ResponseProcessor } from '../common/agentic-openapi-parser';
import { PiiScrubberUtil } from './pii-scrubber.util';

/**
 * Adapts PiiScrubberUtil (Slack-specific PII regex from @slack/constants) into
 * agentic-openapi-parser's ResponseProcessor interface, so it can run as part of the library
 * executor's response-processor pipeline instead of being called by hand.
 */
export class PiiScrubProcessor implements ResponseProcessor {
  process(data: unknown): unknown {
    return PiiScrubberUtil.scrub(data as StrictJsonValue);
  }
}
