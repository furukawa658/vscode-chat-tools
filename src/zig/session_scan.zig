const std = @import("std");

const ScanResult = struct {
    prompt_tokens: u64 = 0,
    completion_tokens: u64 = 0,
    context_size: u64 = 0,
    state: u8 = 3,
};

fn parseNumberAt(value: []const u8, offset: usize) ?u64 {
    var index = offset;
    while (index < value.len and (value[index] == ':' or value[index] == ' ' or value[index] == '\t')) : (index += 1) {}
    const start = index;
    while (index < value.len and std.ascii.isDigit(value[index])) : (index += 1) {}
    if (start == index) return null;
    return std.fmt.parseInt(u64, value[start..index], 10) catch null;
}

fn lastNumber(value: []const u8, marker: []const u8) u64 {
    var end = value.len;
    while (std.mem.lastIndexOf(u8, value[0..end], marker)) |position| {
        if (parseNumberAt(value, position + marker.len)) |number| return number;
        if (position == 0) break;
        end = position;
    }
    return 0;
}

fn lastPosition(value: []const u8, marker: []const u8) ?usize {
    return std.mem.lastIndexOf(u8, value, marker);
}

fn scanState(value: []const u8) u8 {
    const streaming = lastPosition(value, "\"modelState\":{\"value\":0}") orelse 0;
    const complete = lastPosition(value, "\"modelState\":{\"value\":1}") orelse 0;
    const cancelled = lastPosition(value, "\"modelState\":{\"value\":2}") orelse 0;
    if (streaming == 0 and complete == 0 and cancelled == 0) return 3;
    if (streaming >= complete and streaming >= cancelled) return 0;
    if (complete >= cancelled) return 1;
    return 2;
}

fn scan(value: []const u8) ScanResult {
    const context_size = blk: {
        const request_context = lastNumber(value, "\"contextSize\"");
        break :blk if (request_context != 0) request_context else lastNumber(value, "\"maxInputTokens\"");
    };
    return .{
        .prompt_tokens = lastNumber(value, "\"promptTokens\""),
        .completion_tokens = lastNumber(value, "\"completionTokens\""),
        .context_size = context_size,
        .state = scanState(value),
    };
}

pub fn main() !void {
    var allocator_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = allocator_state.deinit();
    const allocator = allocator_state.allocator();
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    if (args.len != 2) return error.InvalidArguments;

    const bytes = try std.fs.cwd().readFileAlloc(allocator, args[1], 256 * 1024 * 1024);
    defer allocator.free(bytes);
    const result = scan(bytes);
    const output = try std.fmt.allocPrint(allocator, "{d}\t{d}\t{d}\t{d}\n", .{
        result.prompt_tokens,
        result.completion_tokens,
        result.context_size,
        result.state,
    });
    defer allocator.free(output);
    try std.fs.File.stdout().writeAll(output);
}
