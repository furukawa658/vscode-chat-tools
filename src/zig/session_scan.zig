const std = @import("std");

const ScanResult = struct {
    prompt_tokens: u64 = 0,
    completion_tokens: u64 = 0,
    state: u8 = 3,
};

fn numberAfter(value: []const u8, offset: usize) ?u64 {
    var index = offset;
    while (index < value.len and (value[index] == ' ' or value[index] == '\t' or value[index] == ':')) : (index += 1) {}
    const start = index;
    while (index < value.len and std.ascii.isDigit(value[index])) : (index += 1) {}
    if (start == index) return null;
    return std.fmt.parseInt(u64, value[start..index], 10) catch null;
}

fn fieldPatch(line: []const u8, field: []const u8) ?struct { index: u64, value: u64, state: u8 } {
    const prefix = "\"k\":[\"requests\",";
    const prefix_at = std.mem.indexOf(u8, line, prefix) orelse return null;
    const index_at = prefix_at + prefix.len;
    var end = index_at;
    while (end < line.len and std.ascii.isDigit(line[end])) : (end += 1) {}
    const request_index = std.fmt.parseInt(u64, line[index_at..end], 10) catch return null;
    const field_prefix = ",\"";
    if (!std.mem.startsWith(u8, line[end..], field_prefix)) return null;
    const expected_at = end + field_prefix.len;
    if (!std.mem.startsWith(u8, line[expected_at..], field)) return null;
    const bracket_at = expected_at + field.len;
    if (!std.mem.startsWith(u8, line[bracket_at..], "\"]")) return null;

    const value_at = std.mem.indexOf(u8, line, "\"v\":") orelse return null;
    if (std.mem.eql(u8, field, "modelState")) {
        const state_at = std.mem.indexOfPos(u8, line, value_at + 4, "\"value\":") orelse return null;
        const state = numberAfter(line, state_at + 8) orelse return null;
        return .{ .index = request_index, .value = 0, .state = @intCast(@min(state, 3)) };
    }
    return .{ .index = request_index, .value = numberAfter(line, value_at + 4) orelse return null, .state = 3 };
}

fn previousLine(value: []const u8, end: usize) ?struct { line: []const u8, next: usize } {
    if (end == 0) return null;
    var line_end = end;
    while (line_end > 0 and (value[line_end - 1] == '\n' or value[line_end - 1] == '\r')) : (line_end -= 1) {}
    const newline = std.mem.lastIndexOfScalar(u8, value[0..line_end], '\n');
    const start = if (newline) |position| position + 1 else 0;
    return .{ .line = value[start..line_end], .next = start };
}

fn lastFieldPatch(value: []const u8, field: []const u8, request_index: ?u64) ?struct { index: u64, value: u64, state: u8 } {
    var end = value.len;
    while (previousLine(value, end)) |entry| {
        if (fieldPatch(entry.line, field)) |patch| {
            if (request_index == null or patch.index == request_index.?) return patch;
        }
        if (entry.next == 0) break;
        end = entry.next - 1;
    }
    return null;
}

fn scanTail(value: []const u8) !ScanResult {
    const prompt = lastFieldPatch(value, "promptTokens", null) orelse return error.MissingPromptTokens;
    const completion = lastFieldPatch(value, "completionTokens", prompt.index);
    const state = lastFieldPatch(value, "modelState", prompt.index);
    return .{
        .prompt_tokens = prompt.value,
        .completion_tokens = if (completion) |patch| patch.value else 0,
        .state = if (state) |patch| patch.state else 3,
    };
}

fn scanFile(allocator: std.mem.Allocator, path: []const u8) !ScanResult {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();
    const size = try file.getEndPos();
    const length: usize = @intCast(@min(size, 4 * 1024 * 1024));
    const bytes = try allocator.alloc(u8, length);
    defer allocator.free(bytes);
    const offset = size - length;
    _ = try file.preadAll(bytes, offset);
    return scanTail(bytes);
}

fn writeResult(allocator: std.mem.Allocator, result: ScanResult) !void {
    const output = try std.fmt.allocPrint(allocator, "{d}\t{d}\t{d}\n", .{
        result.prompt_tokens,
        result.completion_tokens,
        result.state,
    });
    defer allocator.free(output);
    try std.fs.File.stdout().writeAll(output);
}

pub fn main() !void {
    var allocator_state = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = allocator_state.deinit();
    const allocator = allocator_state.allocator();
    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);
    if (args.len == 2) return writeResult(allocator, try scanFile(allocator, args[1]));
    if (args.len != 1) return error.InvalidArguments;

    var stdin = std.fs.File.stdin().deprecatedReader();
    while (true) {
        const input = stdin.readUntilDelimiterOrEofAlloc(allocator, '\n', 8192) catch return;
        const path = input orelse break;
        defer allocator.free(path);
        if (scanFile(allocator, std.mem.trimEnd(u8, path, "\r"))) |result| {
            writeResult(allocator, result) catch return;
        } else |_| {
            std.fs.File.stdout().writeAll("error\n") catch return;
        }
    }
}
