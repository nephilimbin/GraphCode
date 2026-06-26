; Swift Tree-sitter query for call graph extraction
;
; IMPORTANT: the grammar shipped in tree-sitter-wasms unifies class / struct /
; enum / extension under a single `class_declaration` node. struct & enum share
; `class_body` / `enum_class_body` as the body, and an extension wraps its name
; in `user_type`. We cannot distinguish struct from class at the grammar level.
;
; Capture names:
;   @def.function  — free functions, methods, protocol methods
;   @def.class     — class / struct / enum / extension declarations
;   @def.interface — protocol declarations
;   @def.type      — typealias declarations
;   @call          — CALLS relation (function / method / constructor invocations)
;   @inherit       — INHERITS relation (superclass / conformed type)
;   @uses          — USES relation (type references in annotations)

; --------------------------------------------------------------------------
; DEFINITIONS
; --------------------------------------------------------------------------

; Free function and methods (function_declaration is used for both)
(function_declaration
  name: (simple_identifier) @def.function)

; Protocol method requirement
(protocol_function_declaration
  name: (simple_identifier) @def.function)

; class / struct / enum (name is a bare type_identifier)
(class_declaration
  name: (type_identifier) @def.class)

; extension (name is wrapped in user_type, e.g. `extension Foo.Bar`)
(class_declaration
  name: (user_type) @def.class)

; Protocol
(protocol_declaration
  name: (type_identifier) @def.interface)

; Type alias
(typealias_declaration
  name: (type_identifier) @def.type)

; --------------------------------------------------------------------------
; CALLS
; --------------------------------------------------------------------------

; Direct or constructor call: foo(), Bar(x: 1)
; The callee name is the first direct child (simple_identifier) of call_expression.
(call_expression
  (simple_identifier) @call)

; Method call: obj.method()
; The method name is the navigation_suffix's identifier; its parent
; (navigation_suffix) is registered as a member-access parent type so
; unresolved cross-file member calls are filtered (see MEMBER_ACCESS_PARENT_TYPES).
(call_expression
  (navigation_expression
    suffix: (navigation_suffix
      suffix: (simple_identifier) @call)))

; --------------------------------------------------------------------------
; INHERITS (superclass / conformance)
; --------------------------------------------------------------------------

; class Foo: Bar  /  struct Foo: Bar  /  enum Foo: Protocol
(class_declaration
  (inheritance_specifier
    inherits_from: (user_type
      (type_identifier) @inherit)))

; --------------------------------------------------------------------------
; USES (type references)
; --------------------------------------------------------------------------

; Type used in a property / parameter annotation: `var x: Int`, `func f(_ a: String)`
; NOTE: the `type_annotation.name` field cannot be constrained to `user_type`
; in this grammar (query compile fails), so match structurally instead.
(type_annotation
  (user_type
    (type_identifier) @uses))
